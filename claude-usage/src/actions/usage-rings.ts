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
import { limitsService, type LimitsSnapshot } from "../engine/limits";
import { usageService } from "../engine/service";
import { compactDuration, compactTokens, percentLabel } from "../render/format";
import { renderReadout, type ReadoutRow } from "../render/readout";
import { colour, GEOMETRY, PALETTE, renderRings, type ColourName } from "../render/rings";
import { longPressThreshold, performLongPress, type LongPressSettings } from "../system/launch";
import { LongPressTracker } from "./press";

const HOUR = 3_600_000;

/** Claude's session limit runs in 5-hour blocks. */
const SESSION_HOURS = 5;

const log = streamDeck.logger.createScope("rings");

/** Property inspector fields hand back strings, so numbers arrive as text. */
type Numeric = number | string;

export type RingsSettings = {
	layout?: "single" | "dual";

	primaryTracks?: string;
	primaryCustomHours?: Numeric;
	primaryCeiling?: Numeric;
	primaryModel?: string;
	primaryColour?: string;

	secondaryTracks?: string;
	secondaryCustomHours?: Numeric;
	secondaryCeiling?: Numeric;
	secondaryModel?: string;
	secondaryColour?: string;

	showText?: boolean;
	refreshSeconds?: Numeric;
} & LongPressSettings;

const DEFAULTS = {
	layout: "dual" as const,
	primaryTracks: "limit-5h",
	primaryColour: "coral",
	secondaryTracks: "limit-7d",
	secondaryColour: "teal",
	showText: false,
	refreshSeconds: 20
};

/**
 * What a ring is measuring. `limit` comes from Anthropic and needs no ceiling;
 * the others are counted from local transcripts and do.
 */
type RingMode =
	| { kind: "limit"; window: "fiveHour" | "sevenDay" }
	| { kind: "session"; hours: number }
	| { kind: "window"; hours: number };

type ResolvedRing = {
	mode: RingMode;
	ceiling: number;
	model: string | undefined;
	colourName: string;
	/** 0..n of the limit or ceiling. */
	value: number;
	/** Local token total; undefined for API-sourced rings. */
	effective?: number;
	/** Countdown to the reset, when one is known. */
	remainingMs?: number;
	/** False when a session block has expired, or the API numbers are stale. */
	healthy: boolean;
	/**
	 * False when the API has never answered. Distinguishing this from a genuine
	 * 0% matters: a denied keychain prompt would otherwise look like "no usage"
	 * rather than "no data".
	 */
	hasData: boolean;
};

function parseMode(tracks: string | undefined, custom: Numeric | undefined, fallback: string): RingMode {
	const raw = String(tracks ?? fallback);
	switch (raw) {
		case "limit-5h":
			return { kind: "limit", window: "fiveHour" };
		case "limit-7d":
			return { kind: "limit", window: "sevenDay" };
		case "session":
			return { kind: "session", hours: SESSION_HOURS };
		case "custom":
			return { kind: "window", hours: positive(custom, 24) };
		default:
			return { kind: "window", hours: positive(raw, 24) };
	}
}

/**
 * Two concentric activity rings, or one.
 *
 * By default both come from Anthropic's own usage figures — the same source
 * `/usage` reads — so the percentages are exact and need no calibration. The
 * transcript-derived modes remain for what the API cannot answer: per-model
 * usage, and arbitrary windows.
 */
@action({ UUID: "com.kylefsu.claude-usage.rings" })
export class UsageRings extends SingletonAction<RingsSettings> {
	readonly #press = new LongPressTracker();

	#unsubscribe: (() => void)[] = [];

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
			for (const off of this.#unsubscribe) {
				off();
			}
			this.#unsubscribe = [];
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<RingsSettings>): void | Promise<void> {
		this.#applySettings(ev.payload.settings);
		return this.#paint();
	}

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

	/** A short press swaps the face; a long press already acted. */
	override async onKeyUp(ev: KeyUpEvent<RingsSettings>): Promise<void> {
		if (!this.#press.up(ev.action.id)) {
			return;
		}
		const settings = ev.payload.settings ?? {};
		await ev.action.setSettings({ ...settings, showText: !(settings.showText ?? DEFAULTS.showText) });
		// A deliberate press is worth a fresh fetch, cooldown notwithstanding.
		void limitsService.refresh(true);
		await this.#paint();
	}

	#ensureSubscribed(): void {
		if (this.#unsubscribe.length === 0) {
			this.#unsubscribe.push(limitsService.subscribe(() => void this.#paint()));
			this.#unsubscribe.push(usageService.subscribe(() => void this.#paint()));
		}
	}

	#applySettings(settings: RingsSettings | undefined): void {
		const modes = [
			parseMode(settings?.primaryTracks, settings?.primaryCustomHours, DEFAULTS.primaryTracks),
			parseMode(settings?.secondaryTracks, settings?.secondaryCustomHours, DEFAULTS.secondaryTracks)
		];
		const widest = Math.max(...modes.map((m) => (m.kind === "limit" ? 0 : m.hours)), SESSION_HOURS);
		usageService.requireWindow(widest * HOUR);
		usageService.setInterval(positive(settings?.refreshSeconds, DEFAULTS.refreshSeconds) * 1000);
	}

	async #paint(): Promise<void> {
		const now = Date.now();
		const samples = usageService.samples;
		const limits = limitsService.snapshot;

		for (const instance of this.actions) {
			let settings: RingsSettings = {};
			try {
				settings = (await instance.getSettings<RingsSettings>()) ?? {};
			} catch {
				continue;
			}

			const single = (settings.layout ?? DEFAULTS.layout) === "single";

			const primary = resolve(samples, limits, now, {
				mode: parseMode(settings.primaryTracks, settings.primaryCustomHours, DEFAULTS.primaryTracks),
				ceiling: nonNegative(settings.primaryCeiling, 0),
				model: settings.primaryModel,
				colourName: settings.primaryColour ?? DEFAULTS.primaryColour
			});

			const secondary = single
				? undefined
				: resolve(samples, limits, now, {
						mode: parseMode(settings.secondaryTracks, settings.secondaryCustomHours, DEFAULTS.secondaryTracks),
						ceiling: nonNegative(settings.secondaryCeiling, 0),
						model: settings.secondaryModel,
						colourName: settings.secondaryColour ?? DEFAULTS.secondaryColour
					});

			const image = (settings.showText ?? DEFAULTS.showText)
				? renderReadout({
						background: PALETTE.background,
						rows: [primary, ...(secondary ? [secondary] : [])].map((ring, index) =>
							row(ring, index === 0 ? "coral" : "teal")
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
				`paint ${primary.mode.kind} value=${primary.value.toFixed(3)}` +
					` samples=${samples.length} limitsAge=${limits.fetchedAt ? now - limits.fetchedAt : -1}` +
					(limits.error ? ` limitsError=${limits.error}` : "")
			);

			try {
				await instance.setImage(image);
			} catch (err) {
				log.error("setImage failed", err);
			}
		}
	}
}

type RingConfig = { mode: RingMode; ceiling: number; model: string | undefined; colourName: string };

function resolve(
	samples: Parameters<typeof summarise>[0],
	limits: LimitsSnapshot,
	now: number,
	config: RingConfig
): ResolvedRing {
	if (config.mode.kind === "limit") {
		const window = config.mode.window === "fiveHour" ? limits.fiveHour : limits.sevenDay;
		return {
			...config,
			value: window?.fraction ?? 0,
			remainingMs: window?.resetsAt === undefined ? undefined : Math.max(0, window.resetsAt - now),
			healthy: window !== undefined && !limits.stale,
			hasData: window !== undefined
		};
	}

	if (config.mode.kind === "session") {
		const block = currentSessionBlock(samples, now, config.mode.hours * HOUR, { modelFilter: config.model });
		return {
			...config,
			effective: block.effective,
			value: fraction(block.effective, config.ceiling),
			remainingMs: block.remainingMs,
			healthy: block.active,
			hasData: true
		};
	}

	const stat = summarise(samples, now, config.mode.hours * HOUR, { modelFilter: config.model });
	return {
		...config,
		effective: stat.effective,
		value: fraction(stat.effective, config.ceiling),
		healthy: true,
		hasData: true
	};
}

function row(ring: ResolvedRing, fallback: ColourName): ReadoutRow {
	const palette = colour(ring.colourName, fallback);
	// A ceiling-less token ring cannot express a percentage, so it shows tokens.
	const showTokens = ring.mode.kind !== "limit" && ring.ceiling <= 0 && ring.effective !== undefined;

	return {
		value: !ring.hasData ? "—" : showTokens ? compactTokens(ring.effective ?? 0) : percentLabel(ring.value),
		label: label(ring),
		colour: ring.value > 1 ? palette.over : palette.lit
	};
}

function label(ring: ResolvedRing): string {
	if (ring.mode.kind === "limit") {
		if (!ring.hasData) {
			return "NO DATA";
		}
		if (!ring.healthy) {
			return "STALE";
		}
		return ring.remainingMs === undefined
			? ring.mode.window === "fiveHour"
				? "5H"
				: "7D"
			: compactDuration(ring.remainingMs);
	}

	if (ring.mode.kind === "session") {
		return ring.healthy && ring.remainingMs !== undefined ? compactDuration(ring.remainingMs) : "RESET";
	}

	const model = ring.model?.trim();
	if (model) {
		return model.replace(/^claude[-_]?/i, "").slice(0, 6).toUpperCase();
	}
	return ring.mode.hours >= 24 && ring.mode.hours % 24 === 0 ? `${ring.mode.hours / 24}D` : `${ring.mode.hours}H`;
}

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
