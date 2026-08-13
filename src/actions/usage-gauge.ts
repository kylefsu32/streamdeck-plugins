import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent
} from "@elgato/streamdeck";

import { formatCountdown, renderKeySvg, type GaugeSpec } from "../lib/gauge-svg";
import { METRIC_KEYS, METRIC_LABELS, usageClient, type MetricKey, type UsageSnapshot } from "../lib/usage-client";

/** Re-render cadence; countdown text changes at minute granularity. */
const TICK_MS = 60_000;

type GaugeSettings = {
	layout?: string; // "1" | "2"
	metric1?: string;
	metric2?: string;
	pollMinutes?: string;
	showReset?: boolean;
};

type ResolvedSettings = {
	metrics: MetricKey[];
	pollMs: number;
	showReset: boolean;
};

function asMetric(v: string | undefined, fallback: MetricKey): MetricKey {
	return METRIC_KEYS.includes(v as MetricKey) ? (v as MetricKey) : fallback;
}

function resolve(settings: GaugeSettings): ResolvedSettings {
	const twoGauges = settings.layout !== "1";
	const metric1 = asMetric(settings.metric1, "five_hour");
	const metrics = twoGauges ? [metric1, asMetric(settings.metric2, "seven_day")] : [metric1];
	const pollMinutes = Number(settings.pollMinutes);
	const pollMs = (Number.isFinite(pollMinutes) && pollMinutes >= 1 ? pollMinutes : 5) * 60_000;
	return { metrics, pollMs, showReset: settings.showReset !== false };
}

function toGaugeSpec(snapshot: UsageSnapshot | null, key: MetricKey, long: boolean): GaugeSpec {
	const label = long ? METRIC_LABELS[key].long : METRIC_LABELS[key].short;
	const reading = snapshot?.metrics[key];
	if (!reading) return { label, pct: null, resetText: null };
	return {
		label,
		pct: reading.utilization,
		resetText: reading.resetsAt !== null ? formatCountdown(reading.resetsAt - Date.now()) : null
	};
}

@action({ UUID: "com.kylefsu32.claude-gauges.gauge" })
export class UsageGauge extends SingletonAction<GaugeSettings> {
	private timer: NodeJS.Timeout | undefined;
	private lastFetchAt = 0;

	override async onWillAppear(ev: WillAppearEvent<GaugeSettings>): Promise<void> {
		if (!ev.action.isKey()) return;

		// Create the timer before any await: onWillDisappear clears it
		// synchronously, and a check-and-set on the far side of an await could
		// race a coalesced appear/disappear pair and orphan the interval.
		if (!this.timer) {
			this.timer = setInterval(() => this.tick(), TICK_MS);
		}

		// Seed defaults on first placement so the property inspector shows the
		// same values the plugin actually uses.
		let settings = ev.payload.settings;
		if (settings.layout === undefined) {
			settings = {
				layout: "2",
				metric1: "five_hour",
				metric2: "seven_day",
				pollMinutes: "5",
				showReset: true,
				...settings
			};
			await ev.action.setSettings(settings);
		}

		// Paint from cache immediately, then fetch and repaint.
		await this.paint(ev.action, settings, usageClient.last);
		this.fetchAndPaintAll();
	}

	override onWillDisappear(_ev: WillDisappearEvent<GaugeSettings>): void {
		if (this.actions.next().done) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<GaugeSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		await this.paint(ev.action, ev.payload.settings, usageClient.last);
	}

	override async onKeyUp(ev: KeyUpEvent<GaugeSettings>): Promise<void> {
		try {
			const snapshot = await usageClient.fetch(true);
			this.lastFetchAt = snapshot.at;
			await this.paintAll(snapshot);
			if (snapshot.error) {
				await ev.action.showAlert();
			}
		} catch (e) {
			streamDeck.logger.error("Manual refresh failed", e);
			await ev.action.showAlert();
		}
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
		const single = resolved.metrics.length === 1;
		const gauges = resolved.metrics.map((m) => toGaugeSpec(snapshot, m, single));
		const message = snapshot?.error ? snapshot.error.message : undefined;
		const svg = renderKeySvg({ gauges, message }, resolved.showReset);
		await actionKey.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
	}
}
