import streamDeck, {
	action,
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { fraction, summarise } from "../engine/aggregate";
import { usageService } from "../engine/service";
import { compactTokens, percentLabel } from "../render/format";
import { renderReadout, type ReadoutRow } from "../render/readout";
import { colour, GEOMETRY, PALETTE, renderRings, type ColourName } from "../render/rings";
import { longPressThreshold, performLongPress, type LongPressSettings } from "../system/launch";
import { LongPressTracker } from "./press";

const HOUR = 3_600_000;

export type RingsSettings = {
	/** One ring, or an outer/inner pair. */
	layout?: "single" | "dual";

	/** Outer ring in dual layout; the only ring in single layout. */
	primaryHours?: number;
	primaryCeiling?: number;
	primaryModel?: string;
	primaryColour?: string;

	/** Inner ring. Ignored in single layout. */
	secondaryHours?: number;
	secondaryCeiling?: number;
	secondaryModel?: string;
	secondaryColour?: string;

	/** Toggled by pressing the key. Off means rings only. */
	showText?: boolean;
	textMode?: "auto" | "percent" | "tokens";
	refreshSeconds?: number;
} & LongPressSettings;

const DEFAULTS = {
	layout: "dual" as const,
	primaryHours: 5,
	primaryColour: "coral",
	secondaryHours: 168,
	secondaryColour: "teal",
	showText: false,
	textMode: "auto" as const,
	refreshSeconds: 20
};

type ResolvedRing = {
	hours: number;
	ceiling: number;
	model: string | undefined;
	colourName: string;
	effective: number;
	value: number;
};

/**
 * Activity rings over the local transcripts.
 *
 * A key is either a pair (session outside, week inside) or a single ring, which
 * is what makes per-window and per-model keys possible: one key for the 5-hour
 * window, another for the week, another filtered to a single model.
 */
@action({ UUID: "com.kylefsu.claude-usage.rings" })
export class UsageRings extends SingletonAction<RingsSettings> {
	readonly #press = new LongPressTracker();

	#unsubscribe: (() => void) | undefined;

	override onWillAppear(ev: WillAppearEvent<RingsSettings>): void | Promise<void> {
		this.#ensureSubscribed();
		this.#applySettings(ev.payload.settings);
		return this.#paint();
	}

	override onWillDisappear(ev: WillDisappearEvent<RingsSettings>): void {
		this.#press.cancel(ev.action.id);

		let remaining = 0;
		for (const _ of this.actions) {
			remaining += 1;
		}
		if (remaining <= 1) {
			this.#unsubscribe?.();
			this.#unsubscribe = undefined;
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<RingsSettings>): void | Promise<void> {
		this.#applySettings(ev.payload.settings);
		return this.#paint();
	}

	/** Arms the long press; the short action waits for key-up. */
	override onKeyDown(ev: KeyDownEvent<RingsSettings>): void {
		const settings = ev.payload.settings ?? {};
		this.#press.down(ev.action.id, longPressThreshold(settings), () => {
			if (performLongPress(settings)) {
				void ev.action.showOk();
			} else {
				void ev.action.showAlert();
			}
		});
	}

	/** A short press reveals or hides the readout; a long press already acted. */
	override async onKeyUp(ev: KeyUpEvent<RingsSettings>): Promise<void> {
		if (!this.#press.up(ev.action.id)) {
			return;
		}
		const settings = ev.payload.settings ?? {};
		const showText = !(settings.showText ?? DEFAULTS.showText);
		await ev.action.setSettings({ ...settings, showText });
		await this.#paint();
	}

	#ensureSubscribed(): void {
		if (!this.#unsubscribe) {
			this.#unsubscribe = usageService.subscribe(() => void this.#paint());
		}
	}

	#applySettings(settings: RingsSettings | undefined): void {
		const widest = Math.max(
			positive(settings?.primaryHours, DEFAULTS.primaryHours),
			settings?.layout === "single" ? 0 : positive(settings?.secondaryHours, DEFAULTS.secondaryHours)
		);
		usageService.requireWindow(widest * HOUR);
		usageService.setInterval(positive(settings?.refreshSeconds, DEFAULTS.refreshSeconds) * 1000);
	}

	async #paint(): Promise<void> {
		const now = Date.now();
		const samples = usageService.samples;

		for (const instance of this.actions) {
			let settings: RingsSettings = {};
			try {
				settings = (await instance.getSettings<RingsSettings>()) ?? {};
			} catch {
				continue; // instance vanished between iteration and read
			}

			const single = (settings.layout ?? DEFAULTS.layout) === "single";

			const primary = resolve(samples, now, {
				hours: positive(settings.primaryHours, DEFAULTS.primaryHours),
				ceiling: nonNegative(settings.primaryCeiling, 0),
				model: settings.primaryModel,
				colourName: settings.primaryColour ?? DEFAULTS.primaryColour
			});

			const secondary = single
				? undefined
				: resolve(samples, now, {
						hours: positive(settings.secondaryHours, DEFAULTS.secondaryHours),
						ceiling: nonNegative(settings.secondaryCeiling, 0),
						model: settings.secondaryModel,
						colourName: settings.secondaryColour ?? DEFAULTS.secondaryColour
					});

			// Pressed swaps the face entirely: text with no rings, so the figures
			// get the whole canvas instead of the rings' centre hole.
			const image = (settings.showText ?? DEFAULTS.showText)
				? renderReadout({
						background: PALETTE.background,
						rows: [primary, ...(secondary ? [secondary] : [])].map((ring) =>
							this.#row(settings, ring, ring === primary ? "coral" : "teal")
						)
					})
				: renderRings({
						background: PALETTE.background,
						rings: single
							? [{ value: primary.value, ...GEOMETRY.solo, ...colour(primary.colourName, "coral") }]
							: [
									{ value: primary.value, ...GEOMETRY.outer, ...colour(primary.colourName, "coral") },
									{ value: secondary!.value, ...GEOMETRY.inner, ...colour(secondary!.colourName, "teal") }
								]
					});

			try {
				await instance.setImage(image);
			} catch (err) {
				streamDeck.logger.warn("setImage failed", err);
			}
		}
	}

	#row(settings: RingsSettings, ring: ResolvedRing, fallback: ColourName): ReadoutRow {
		const mode = settings.textMode ?? DEFAULTS.textMode;
		// A percentage without a ceiling would be meaningless, so "auto" falls
		// back to the raw effective-token count until one is calibrated.
		const asPercent = mode === "percent" || (mode === "auto" && ring.ceiling > 0);
		const palette = colour(ring.colourName, fallback);

		return {
			value: asPercent ? percentLabel(ring.value) : compactTokens(ring.effective),
			label: subLabel(ring),
			// Over budget reads red here too, matching what the ring would show.
			colour: ring.value > 1 ? palette.over : palette.lit
		};
	}
}

function resolve(
	samples: Parameters<typeof summarise>[0],
	now: number,
	config: { hours: number; ceiling: number; model: string | undefined; colourName: string }
): ResolvedRing {
	const stat = summarise(samples, now, config.hours * HOUR, { modelFilter: config.model });
	return {
		...config,
		effective: stat.effective,
		value: fraction(stat.effective, config.ceiling)
	};
}

/** A model filter is the more useful caption when one is set. */
function subLabel(ring: ResolvedRing): string {
	const model = ring.model?.trim();
	if (model) {
		return model.replace(/^claude[-_]?/i, "").slice(0, 6).toUpperCase();
	}
	return windowLabel(ring.hours);
}

function windowLabel(hours: number): string {
	if (hours >= 24 && hours % 24 === 0) {
		return `${hours / 24}D`;
	}
	return `${hours}H`;
}

function positive(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
