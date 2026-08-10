import streamDeck, {
	action,
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { burnRatePerHour, fraction, summarise, timeToCeiling } from "../engine/aggregate";
import { usageService } from "../engine/service";
import { compactDuration, compactTokens } from "../render/format";
import { renderReadout } from "../render/readout";
import { colour, GEOMETRY, PALETTE, renderRings } from "../render/rings";

const HOUR = 3_600_000;
const MINUTE = 60_000;

export type BurnSettings = {
	/** Window the rate is measured over, in minutes. */
	rateWindowMinutes?: number;
	sessionHours?: number;
	sessionCeiling?: number;
	/** Case-insensitive substring on the model id, e.g. "fable". */
	model?: string;
	ringColour?: string;
	display?: "rate" | "eta";
	/** Toggled by pressing the key. Off means ring only. */
	showText?: boolean;
	refreshSeconds?: number;
};

const DEFAULTS = {
	rateWindowMinutes: 60,
	sessionHours: 5,
	sessionCeiling: 0,
	ringColour: "coral",
	display: "rate" as const,
	showText: false,
	refreshSeconds: 20
};

/**
 * Current spend rate, and how long the session ceiling lasts at that rate.
 *
 * The ring shows how much of the session ceiling is already gone, so the key
 * carries both "how fast" and "how far in" at a glance.
 */
@action({ UUID: "com.kylefsu.claude-usage.burn" })
export class BurnRate extends SingletonAction<BurnSettings> {
	#unsubscribe: (() => void) | undefined;

	override onWillAppear(ev: WillAppearEvent<BurnSettings>): void | Promise<void> {
		this.#ensureSubscribed();
		this.#applySettings(ev.payload.settings);
		return this.#paint();
	}

	override onWillDisappear(_ev: WillDisappearEvent<BurnSettings>): void {
		let remaining = 0;
		for (const _ of this.actions) {
			remaining += 1;
		}
		if (remaining <= 1) {
			this.#unsubscribe?.();
			this.#unsubscribe = undefined;
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<BurnSettings>): void | Promise<void> {
		this.#applySettings(ev.payload.settings);
		return this.#paint();
	}

	/** Pressing reveals or hides the readout, matching the rings key. */
	override async onKeyDown(ev: KeyDownEvent<BurnSettings>): Promise<void> {
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

	#applySettings(settings: BurnSettings | undefined): void {
		usageService.requireWindow(positive(settings?.sessionHours, DEFAULTS.sessionHours) * HOUR);
		usageService.setInterval(positive(settings?.refreshSeconds, DEFAULTS.refreshSeconds) * 1000);
	}

	async #paint(): Promise<void> {
		const now = Date.now();
		const samples = usageService.samples;

		for (const instance of this.actions) {
			let settings: BurnSettings = {};
			try {
				settings = (await instance.getSettings<BurnSettings>()) ?? {};
			} catch {
				continue;
			}

			const rateWindow = positive(settings.rateWindowMinutes, DEFAULTS.rateWindowMinutes) * MINUTE;
			const sessionMs = positive(settings.sessionHours, DEFAULTS.sessionHours) * HOUR;
			const ceiling = nonNegative(settings.sessionCeiling, DEFAULTS.sessionCeiling);

			const filter = { modelFilter: settings.model };
			const rate = burnRatePerHour(samples, now, rateWindow, filter);
			const session = summarise(samples, now, sessionMs, filter);
			const used = fraction(session.effective, ceiling);

			const palette = colour(settings.ringColour, "coral");
			const readout =
				(settings.display ?? DEFAULTS.display) === "eta"
					? this.#eta(session.effective, ceiling, rate)
					: { value: compactTokens(rate), label: "/HR" };

			// Pressed swaps the face entirely: text with no ring.
			const image = (settings.showText ?? DEFAULTS.showText)
				? renderReadout({
						background: PALETTE.background,
						rows: [{ ...readout, colour: used > 1 ? palette.over : palette.lit }]
					})
				: renderRings({
						background: PALETTE.background,
						rings: [{ value: used, ...GEOMETRY.solo, ...palette }]
					});

			try {
				await instance.setImage(image);
			} catch (err) {
				streamDeck.logger.warn("setImage failed", err);
			}
		}
	}

	#eta(used: number, ceiling: number, rate: number): { value: string; label: string } {
		if (ceiling <= 0) {
			return { value: "—", label: "NO CEILING" };
		}
		const remainingMs = timeToCeiling(used, ceiling, rate);
		if (remainingMs === undefined) {
			return { value: "∞", label: "LEFT" };
		}
		if (remainingMs === 0) {
			return { value: "0", label: "LEFT" };
		}
		return { value: compactDuration(remainingMs), label: "LEFT" };
	}
}

function positive(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
