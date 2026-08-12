import streamDeck, {
	action,
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { currentSessionBlock, fraction, summarise } from "../engine/aggregate";
import { usageService } from "../engine/service";
import { compactDuration, compactTokens, percentLabel } from "../render/format";
import { renderReadout, type ReadoutRow } from "../render/readout";
import { colour, GEOMETRY, PALETTE, renderRings, type ColourName } from "../render/rings";
import { longPressThreshold, performLongPress, type LongPressSettings } from "../system/launch";
import { LongPressTracker } from "./press";

const HOUR = 3_600_000;

const log = streamDeck.logger.createScope("rings");

/**
 * Property inspector fields hand back strings — a number textfield stores
 * "40000000", not 40000000 — so every numeric setting has to tolerate both.
 */
type Numeric = number | string;

export type RingsSettings = {
	/** One ring, or an outer/inner pair. */
	layout?: "single" | "dual";

	/** Outer ring in dual layout; the only ring in single layout. */
	primaryHours?: Numeric;
	primaryCustomHours?: Numeric;
	primaryCeiling?: Numeric;
	primaryModel?: string;
	primaryColour?: string;

	/** Inner ring. Ignored in single layout. */
	secondaryHours?: Numeric;
	secondaryCustomHours?: Numeric;
	secondaryCeiling?: Numeric;
	secondaryModel?: string;
	secondaryColour?: string;

	/** Toggled by pressing the key. Off means rings only. */
	showText?: boolean;
	textMode?: "auto" | "percent" | "tokens";
	refreshSeconds?: Numeric;
} & LongPressSettings;

/** Claude's session limit runs in 5-hour blocks. */
const SESSION_HOURS = 5;

const DEFAULTS = {
	layout: "dual" as const,
	primaryWindow: "session",
	primaryColour: "coral",
	secondaryWindow: "168",
	secondaryColour: "teal",
	showText: false,
	textMode: "auto" as const,
	refreshSeconds: 20
};

type ResolvedRing = {
	/** True when this ring tracks the 5-hour session block. */
	session: boolean;
	hours: number;
	ceiling: number;
	model: string | undefined;
	colourName: string;
	effective: number;
	value: number;
	/** Time until the session block resets. */
	remainingMs?: number;
	/** False when a session block has expired and usage is back to zero. */
	active: boolean;
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
		log.info(`appeared (${ev.action.id})`);
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
			windowOf(settings?.primaryHours, settings?.primaryCustomHours, DEFAULTS.primaryWindow).hours,
			settings?.layout === "single"
				? 0
				: windowOf(settings?.secondaryHours, settings?.secondaryCustomHours, DEFAULTS.secondaryWindow).hours
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
				...windowOf(settings.primaryHours, settings.primaryCustomHours, DEFAULTS.primaryWindow),
				ceiling: nonNegative(settings.primaryCeiling, 0),
				model: settings.primaryModel,
				colourName: settings.primaryColour ?? DEFAULTS.primaryColour
			});

			const secondary = single
				? undefined
				: resolve(samples, now, {
						...windowOf(settings.secondaryHours, settings.secondaryCustomHours, DEFAULTS.secondaryWindow),
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

			log.debug(
				`paint ${single ? "single" : "dual"} primary=${primary.effective.toFixed(0)}` +
					` value=${primary.value.toFixed(3)} samples=${samples.length} imageChars=${image.length}`
			);

			try {
				await instance.setImage(image);
			} catch (err) {
				log.error("setImage failed", err);
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
	config: { session: boolean; hours: number; ceiling: number; model: string | undefined; colourName: string }
): ResolvedRing {
	if (config.session) {
		const block = currentSessionBlock(samples, now, config.hours * HOUR, { modelFilter: config.model });
		return {
			...config,
			effective: block.effective,
			value: fraction(block.effective, config.ceiling),
			remainingMs: block.remainingMs,
			active: block.active
		};
	}

	const stat = summarise(samples, now, config.hours * HOUR, { modelFilter: config.model });
	return {
		...config,
		effective: stat.effective,
		value: fraction(stat.effective, config.ceiling),
		active: true
	};
}

/**
 * For a session ring the time left before the block resets is the most useful
 * caption; elsewhere a model filter identifies the key, falling back to the
 * window length.
 */
function subLabel(ring: ResolvedRing): string {
	if (ring.session) {
		if (!ring.active) {
			return "RESET";
		}
		return ring.remainingMs === undefined ? "5H" : compactDuration(ring.remainingMs);
	}

	const model = ring.model?.trim();
	if (model) {
		return model.replace(/^claude[-_]?/i, "").slice(0, 6).toUpperCase();
	}
	return windowLabel(ring.hours);
}

/**
 * The picker stores either "session", "custom", or a literal number of hours.
 */
function windowOf(
	preset: Numeric | undefined,
	custom: Numeric | undefined,
	fallback: string
): { session: boolean; hours: number } {
	const raw = String(preset ?? fallback);
	if (raw === "session") {
		return { session: true, hours: SESSION_HOURS };
	}
	if (raw === "custom") {
		return { session: false, hours: positive(custom, Number(fallback) || SESSION_HOURS) };
	}
	return { session: false, hours: positive(raw, Number(fallback) || SESSION_HOURS) };
}

function windowLabel(hours: number): string {
	if (hours >= 24 && hours % 24 === 0) {
		return `${hours / 24}D`;
	}
	return `${hours}H`;
}

/** Accepts the strings the property inspector stores as well as real numbers. */
function toNumber(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function positive(value: unknown, fallback: number): number {
	const parsed = toNumber(value);
	return parsed !== undefined && parsed > 0 ? parsed : fallback;
}

function nonNegative(value: unknown, fallback: number): number {
	const parsed = toNumber(value);
	return parsed !== undefined && parsed >= 0 ? parsed : fallback;
}

