import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent
} from "@elgato/streamdeck";

import {
	DEFAULT_COLORS,
	formatCountdown,
	renderKeySvg,
	sanitizeColor,
	type ColorOptions,
	type GaugeSpec,
	type TextOptions
} from "../lib/gauge-svg";
import { launchClaudeTerminal } from "../lib/launch-claude";
import { METRIC_KEYS, METRIC_LABELS, usageClient, type MetricKey, type UsageSnapshot } from "../lib/usage-client";

/** Re-render cadence; countdown text changes at minute granularity. */
const TICK_MS = 60_000;

/** Press-and-hold threshold for the force-refresh gesture. */
const LONG_PRESS_MS = 600;

type GaugeSettings = {
	/** Legacy 0.1.0 setting ("1" | "2"), migrated into the view flags. */
	layout?: string;
	metric1?: string;
	metric2?: string;
	pollMinutes?: string;
	showReset?: boolean;
	showPct?: boolean;
	showLabel?: boolean;
	viewBars?: boolean;
	viewArc1?: boolean;
	viewArc2?: boolean;
	viewIndex?: number;
	/** Identity of the currently displayed view, so PI changes can't jump the key off it. */
	currentView?: string;
	colorMode?: string;
	colorA?: string;
	colorB?: string;
	colorBg?: string;
};

type ViewSpec = { slot: "bars"; kind: "bars" } | { slot: "arc1" | "arc2"; kind: "arc"; metric: MetricKey };

type ResolvedSettings = {
	views: ViewSpec[];
	viewIndex: number;
	metric1: MetricKey;
	metric2: MetricKey;
	pollMs: number;
	text: TextOptions;
	colors: ColorOptions;
};

function asMetric(v: string | undefined, fallback: MetricKey): MetricKey {
	return METRIC_KEYS.includes(v as MetricKey) ? (v as MetricKey) : fallback;
}

function resolve(settings: GaugeSettings): ResolvedSettings {
	const metric1 = asMetric(settings.metric1, "five_hour");
	const metric2 = asMetric(settings.metric2, "seven_day");

	// Legacy keys placed on 0.1.0 chose "1 gauge" or "2 gauges"; map that onto
	// the equivalent view set when the new flags are absent.
	const legacySingle = settings.layout === "1";
	const viewBars = settings.viewBars ?? !legacySingle;
	const viewArc1 = settings.viewArc1 ?? true;
	const viewArc2 = settings.viewArc2 ?? !legacySingle;

	const views: ViewSpec[] = [];
	if (viewBars) views.push({ slot: "bars", kind: "bars" });
	if (viewArc1) views.push({ slot: "arc1", kind: "arc", metric: metric1 });
	if (viewArc2) views.push({ slot: "arc2", kind: "arc", metric: metric2 });
	if (views.length === 0) views.push({ slot: "bars", kind: "bars" });

	// Relocate the persisted view identity first: unchecking some OTHER view in
	// the PI must not move the key off the view it is showing. The positional
	// index is only the fallback for when the identified view was removed.
	const bySlot = views.findIndex((v) => v.slot === settings.currentView);
	const rawIndex = typeof settings.viewIndex === "number" ? settings.viewIndex : 0;
	const viewIndex = bySlot >= 0 ? bySlot : ((Math.trunc(rawIndex) % views.length) + views.length) % views.length;

	const pollMinutes = Number(settings.pollMinutes);
	const pollMs = (Number.isFinite(pollMinutes) && pollMinutes >= 1 ? pollMinutes : 5) * 60_000;

	const mode =
		settings.colorMode === "custom" || settings.colorMode === "gradient" ? settings.colorMode : "threshold";

	return {
		views,
		viewIndex,
		metric1,
		metric2,
		pollMs,
		text: {
			showPct: settings.showPct !== false,
			showLabel: settings.showLabel !== false,
			showReset: settings.showReset !== false
		},
		colors: {
			mode,
			bg: sanitizeColor(settings.colorBg, DEFAULT_COLORS.bg),
			colorA: sanitizeColor(settings.colorA, DEFAULT_COLORS.colorA),
			colorB: sanitizeColor(settings.colorB, DEFAULT_COLORS.colorB)
		}
	};
}

function toGaugeSpec(snapshot: UsageSnapshot | null, key: MetricKey): GaugeSpec {
	const labels = METRIC_LABELS[key];
	const reading = snapshot?.metrics[key];
	if (!reading) return { labelShort: labels.short, labelLong: labels.long, pct: null, resetText: null };
	return {
		labelShort: labels.short,
		labelLong: labels.long,
		pct: reading.utilization,
		resetText: reading.resetsAt !== null ? formatCountdown(reading.resetsAt - Date.now()) : null
	};
}

@action({ UUID: "com.kylefsu32.claude-gauges.gauge" })
export class UsageGauge extends SingletonAction<GaugeSettings> {
	private timer: NodeJS.Timeout | undefined;
	private lastFetchAt = 0;
	private pressedAt = new Map<string, number>();
	private recoveryTimers: NodeJS.Timeout[] = [];
	private lastLaunchAt = 0;

	override async onWillAppear(ev: WillAppearEvent<GaugeSettings>): Promise<void> {
		if (!ev.action.isKey()) return;

		// Create the timer before any await: onWillDisappear clears it
		// synchronously, and a check-and-set on the far side of an await could
		// race a coalesced appear/disappear pair and orphan the interval.
		if (!this.timer) {
			this.timer = setInterval(() => this.tick(), TICK_MS);
		}

		// Seed defaults on first placement (and upgrade legacy 0.1.0 keys) so
		// the property inspector shows the same values the plugin actually uses.
		let settings = ev.payload.settings;
		if (settings.viewBars === undefined || settings.showPct === undefined || settings.colorMode === undefined) {
			const legacySingle = settings.layout === "1";
			settings = {
				metric1: "five_hour",
				metric2: "seven_day",
				pollMinutes: "5",
				showReset: true,
				showPct: true,
				showLabel: true,
				viewBars: !legacySingle,
				viewArc1: true,
				viewArc2: !legacySingle,
				viewIndex: 0,
				currentView: legacySingle ? "arc1" : "bars",
				colorMode: "threshold",
				colorA: DEFAULT_COLORS.colorA,
				colorB: DEFAULT_COLORS.colorB,
				colorBg: DEFAULT_COLORS.bg,
				...settings
			};
			await ev.action.setSettings(settings);
		}

		// Paint from cache immediately, then fetch and repaint.
		await this.paint(ev.action, settings, usageClient.last);
		this.fetchAndPaintAll();
	}

	override onWillDisappear(ev: WillDisappearEvent<GaugeSettings>): void {
		this.pressedAt.delete(ev.action.id);
		if (this.actions.next().done) {
			clearInterval(this.timer);
			this.timer = undefined;
			// Recovery timers deliberately survive disappear: launching Terminal
			// can trigger an app-specific profile switch that hides the keys, and
			// the polls must keep running so the keys return healed. They are
			// one-shot and bounded, so nothing leaks.
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<GaugeSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		await this.paint(ev.action, ev.payload.settings, usageClient.last);
	}

	override onKeyDown(ev: KeyDownEvent<GaugeSettings>): void {
		this.pressedAt.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<GaugeSettings>): Promise<void> {
		const started = this.pressedAt.get(ev.action.id);
		this.pressedAt.delete(ev.action.id);
		// An unmatched keyUp (plugin restarted mid-hold) takes the refresh path:
		// it mutates no persisted state, unlike a cycle.
		const longPress = started === undefined || Date.now() - started >= LONG_PRESS_MS;

		const settings = ev.payload.settings;
		const resolved = resolve(settings);

		// In a sign-in state, a short press opens a terminal running claude:
		// fixing the credentials beats cycling views that all show the same
		// error. Hold still forces a refresh for users who fixed it elsewhere.
		const lastError = usageClient.last?.error?.kind;
		if (!longPress && (lastError === "expired" || lastError === "no-credentials")) {
			if (Date.now() - this.lastLaunchAt < 5_000) {
				// A terminal from the recent successful launch is already open.
				await ev.action.showOk();
				return;
			}

			// The deciding snapshot can be a full poll interval old and the user
			// may have signed in elsewhere since. Re-check before opening a
			// terminal at them; the expired determination is local, so this is
			// cheap and reliable.
			let snapshot = usageClient.last;
			if (!snapshot || Date.now() - snapshot.at > 30_000) {
				snapshot = await usageClient.fetch(true);
				this.lastFetchAt = snapshot.at;
				await this.paintAll(snapshot);
			}
			const kind = snapshot.error?.kind;
			if (kind !== "expired" && kind !== "no-credentials") {
				// Healed on this very press, or a different problem (e.g. offline)
				// where a terminal would not help.
				await (snapshot.error ? ev.action.showAlert() : ev.action.showOk());
				return;
			}

			// Stamp before the await so a rapid double press cannot open two
			// terminals; roll back on failure so a retry press is not swallowed.
			this.lastLaunchAt = Date.now();
			try {
				await launchClaudeTerminal();
			} catch (e) {
				this.lastLaunchAt = 0;
				streamDeck.logger.error("Failed to open a terminal running claude", e);
				await ev.action.showAlert();
				return;
			}
			try {
				await ev.action.showOk();
				this.scheduleRecoveryPolls();
			} catch (e) {
				streamDeck.logger.error("Post-launch feedback failed", e);
			}
			return;
		}

		// Short press cycles views when there is more than one; hold to force a
		// refresh. A single-view key keeps the old refresh-on-press behavior.
		if (!longPress && resolved.views.length > 1) {
			const nextIndex = (resolved.viewIndex + 1) % resolved.views.length;
			const next: GaugeSettings = {
				...settings,
				viewIndex: nextIndex,
				currentView: resolved.views[nextIndex].slot
			};
			await ev.action.setSettings(next);
			await this.paint(ev.action, next, usageClient.last);
			return;
		}

		try {
			const snapshot = await usageClient.fetch(true);
			this.lastFetchAt = snapshot.at;
			await this.paintAll(snapshot);
			if (snapshot.error) {
				await ev.action.showAlert();
			} else {
				await ev.action.showOk();
			}
		} catch (e) {
			streamDeck.logger.error("Manual refresh failed", e);
			await ev.action.showAlert();
		}
	}

	/**
	 * After launching claude, poll a few times over the next two minutes so the
	 * key heals itself once the user signs in, instead of waiting a full poll
	 * interval. Forced fetches still respect the client's 10s manual floor.
	 */
	private scheduleRecoveryPolls(): void {
		for (const t of this.recoveryTimers) clearTimeout(t);
		this.recoveryTimers = [20_000, 50_000, 110_000].map((delay) =>
			setTimeout(async () => {
				try {
					const snapshot = await usageClient.fetch(true);
					this.lastFetchAt = snapshot.at;
					await this.paintAll(snapshot);
				} catch (e) {
					streamDeck.logger.error("Recovery poll failed", e);
				}
			}, delay)
		);
	}

	/** Once a minute: repaint countdowns, and re-fetch when the shortest configured interval is due. */
	private async tick(): Promise<void> {
		try {
			const pollMs = await this.shortestPollMs();
			// Half-tick tolerance: lastFetchAt lags the triggering tick by fetch
			// latency, and without slack every interval slips one full tick.
			if (Date.now() - this.lastFetchAt >= pollMs - TICK_MS / 2) {
				await this.fetchAndPaintAll();
			} else {
				await this.paintAll(usageClient.last);
			}
		} catch (e) {
			streamDeck.logger.error("Tick failed", e);
		}
	}

	private async shortestPollMs(): Promise<number> {
		let min = Number.POSITIVE_INFINITY;
		for (const a of this.actions) {
			const settings = resolve(await a.getSettings());
			min = Math.min(min, settings.pollMs);
		}
		return Number.isFinite(min) ? min : 5 * 60_000;
	}

	private async fetchAndPaintAll(): Promise<void> {
		try {
			const snapshot = await usageClient.fetch();
			// Stamp with the snapshot's own fetch-start time: a cached return must
			// not push the next real fetch out, and a live one must not slip a tick.
			this.lastFetchAt = snapshot.at;
			await this.paintAll(snapshot);
		} catch (e) {
			streamDeck.logger.error("Usage fetch failed", e);
		}
	}

	private async paintAll(snapshot: UsageSnapshot | null): Promise<void> {
		for (const a of this.actions) {
			if (!a.isKey()) continue;
			try {
				await this.paint(a, await a.getSettings(), snapshot);
			} catch (e) {
				streamDeck.logger.error("Paint failed", e);
			}
		}
	}

	private async paint(actionKey: KeyAction<GaugeSettings>, settings: GaugeSettings, snapshot: UsageSnapshot | null): Promise<void> {
		const resolved = resolve(settings);
		const view = resolved.views[resolved.viewIndex];
		const gauges =
			view.kind === "bars"
				? [toGaugeSpec(snapshot, resolved.metric1), toGaugeSpec(snapshot, resolved.metric2)]
				: [toGaugeSpec(snapshot, view.metric)];
		const message = snapshot?.error ? snapshot.error.message : undefined;
		const svg = renderKeySvg({ gauges, message }, resolved.text, resolved.colors);
		await actionKey.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
	}
}
