import streamDeck, {
	action,
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { burnRatePerHour, currentSessionBlock, fraction, timeToCeiling, type SessionBlock } from "../engine/aggregate";
import { usageService } from "../engine/service";
import { compactDuration, compactTokens } from "../render/format";
import { renderReadout } from "../render/readout";
import { colour, GEOMETRY, PALETTE, renderRings } from "../render/rings";
import { longPressThreshold, performLongPress, type LongPressSettings } from "../system/launch";
import { LongPressTracker } from "./press";

const HOUR = 3_600_000;
const MINUTE = 60_000;

export type BurnSettings = {
	/** Window the rate is measured over, in minutes. */
	rateWindowMinutes?: number | string;
	sessionHours?: number | string;
	sessionCeiling?: number | string;
	/** Case-insensitive substring on the model id, e.g. "fable". */
	model?: string;
	ringColour?: string;
	display?: "rate" | "eta";
	/** Toggled by pressing the key. Off means ring only. */
	showText?: boolean;
	refreshSeconds?: number | string;
} & LongPressSettings;

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
	readonly #press = new LongPressTracker();

	#unsubscribe: (() => void) | undefined;

	override onWillAppear(ev: WillAppearEvent<BurnSettings>): void | Promise<void> {
		this.#ensureSubscribed();
		this.#applySettings(ev.payload.settings);
		return this.#paint();
	}

	override onWillDisappear(ev: WillDisappearEvent<BurnSettings>): void {
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

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<BurnSettings>): void | Promise<void> {
		this.#applySettings(ev.payload.settings);
		return this.#paint();
	}

	/** Arms the long press; the short action waits for key-up. */
	override onKeyDown(ev: KeyDownEvent<BurnSettings>): void {
		const settings = ev.payload.settings ?? {};
		this.#press.down(ev.action.id, longPressThreshold(settings), () => {
			if (performLongPress(settings)) {
				void ev.action.showOk();
			} else {
				void ev.action.showAlert();
			}
		});
	}

	/** A short press reveals or hides the readout, matching the rings key. */
	override async onKeyUp(ev: KeyUpEvent<BurnSettings>): Promise<void> {
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
			// The session limit is a fixed block, so measure against the block
			// that is currently accruing rather than a trailing window.
			const block = currentSessionBlock(samples, now, sessionMs, filter);
			const used = fraction(block.effective, ceiling);

			const palette = colour(settings.ringColour, "coral");
			const readout =
				(settings.display ?? DEFAULTS.display) === "eta"
					? this.#eta(block, ceiling, rate)
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

	/**
	 * Whichever comes first: hitting the ceiling, or the block resetting. At a
	 * low enough rate the reset always wins, and saying "3h to limit" when the
	 * limit clears in 40 minutes would be actively misleading.
	 */
	#eta(block: SessionBlock, ceiling: number, rate: number): { value: string; label: string } {
		if (ceiling <= 0) {
			return { value: "—", label: "NO CEILING" };
		}

		const toCeiling = timeToCeiling(block.effective, ceiling, rate);
		if (toCeiling === 0) {
			return { value: "0", label: "TO LIMIT" };
		}

		if (toCeiling === undefined || (block.remainingMs !== undefined && toCeiling > block.remainingMs)) {
			return block.remainingMs === undefined
				? { value: "—", label: "IDLE" }
				: { value: compactDuration(block.remainingMs), label: "TO RESET" };
		}

		return { value: compactDuration(toCeiling), label: "TO LIMIT" };
	}
}

/** Property inspector fields hand back strings, so coerce before comparing. */
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
