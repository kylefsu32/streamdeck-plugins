import type { JsonObject } from "@elgato/utils";
import streamDeck, {
	action,
	SingletonAction,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type KeyDownEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { dataUrl } from "../render/svg";
import { usageBarKey, usageForecastKey, usageRingKey, usageStrip, type UsageView } from "../render/usage";
import { METRIC_KEYS, usageClient, type MetricKey } from "../usage/client";
import { StoreAction } from "./base";

/**
 * One poller for every usage key and dial: the endpoint is rate-limited, so
 * the client already refuses to fetch more than once a minute, and this only
 * asks while something is on screen to show it.
 */
const POLL_MS = 60_000;
let viewers = 0;
let timer: NodeJS.Timeout | undefined;
function watch(on: boolean): void {
	viewers = Math.max(0, viewers + (on ? 1 : -1));
	if (viewers > 0 && !timer) {
		void usageClient.fetch();
		timer = setInterval(() => void usageClient.fetch(), POLL_MS);
	} else if (viewers === 0 && timer) {
		clearInterval(timer);
		timer = undefined;
	}
}

function metricOf(v: unknown, fallback: MetricKey): MetricKey {
	return METRIC_KEYS.includes(v as MetricKey) ? (v as MetricKey) : fallback;
}

const view = (metric: MetricKey): UsageView => ({ metric, snapshot: usageClient.last, now: Date.now() });

type UsageSettings = JsonObject & { metric?: string; style?: "bar" | "ring" | "forecast" };

/**
 * Usage — one limit on a key, as a bar, a ring or a forecast. Press to
 * refresh now (at most every 10 seconds).
 */
@action({ UUID: "com.kylefsu.claude-harness.usage" })
export class UsageKey extends StoreAction<UsageSettings> {
	protected override appeared(): void {
		watch(true);
	}

	protected override disappeared(): void {
		watch(false);
	}

	protected render(s: UsageSettings): string {
		const style = s.style ?? "bar";
		const v = view(metricOf(s.metric, style === "ring" ? "five_hour" : "seven_day"));
		return style === "ring" ? usageRingKey(v) : style === "forecast" ? usageForecastKey(v) : usageBarKey(v);
	}

	override async onKeyDown(_ev: KeyDownEvent<UsageSettings>): Promise<void> {
		await usageClient.fetch(true);
		this.paintAll();
	}
}

type StripSettings = JsonObject & { metric?: string };

/**
 * Usage strip — the Stream Deck + touch strip above a dial. Turn the dial to
 * step through the limits; press or tap to refresh.
 */
@action({ UUID: "com.kylefsu.claude-harness.usage-strip" })
export class UsageStrip extends SingletonAction<StripSettings> {
	readonly #dials = new Map<string, { action: DialAction<StripSettings>; metric: MetricKey; last?: string }>();
	#timer: NodeJS.Timeout | undefined;

	override onWillAppear(ev: WillAppearEvent<StripSettings>): void {
		if (!ev.action.isDial()) return;
		this.#dials.set(ev.action.id, { action: ev.action, metric: metricOf(ev.payload.settings?.metric, "seven_day") });
		watch(true);
		this.#timer ??= setInterval(() => this.#paintAll(), 1000);
		this.#paint(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<StripSettings>): void {
		if (!this.#dials.delete(ev.action.id)) return;
		watch(false);
		if (this.#dials.size === 0 && this.#timer) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		}
	}

	override onDialRotate(ev: DialRotateEvent<StripSettings>): void {
		const d = this.#dials.get(ev.action.id);
		if (!d) return;
		const i = METRIC_KEYS.indexOf(d.metric);
		const step = ev.payload.ticks > 0 ? 1 : -1;
		d.metric = METRIC_KEYS[(i + step + METRIC_KEYS.length) % METRIC_KEYS.length]!;
		void ev.action.setSettings({ ...(ev.payload.settings ?? {}), metric: d.metric });
		this.#paint(ev.action.id);
	}

	override async onDialDown(_ev: DialDownEvent<StripSettings>): Promise<void> {
		await usageClient.fetch(true);
		this.#paintAll();
	}

	override async onTouchTap(_ev: TouchTapEvent<StripSettings>): Promise<void> {
		await usageClient.fetch(true);
		this.#paintAll();
	}

	#paintAll(): void {
		for (const id of this.#dials.keys()) this.#paint(id);
	}

	#paint(id: string): void {
		const d = this.#dials.get(id);
		if (!d) return;
		const image = dataUrl(usageStrip(view(d.metric)));
		if (image === d.last) return;
		d.last = image;
		d.action.setFeedback({ canvas: image }).catch((err) => {
			d.last = undefined;
			streamDeck.logger.warn("usage strip feedback failed", err);
		});
	}
}
