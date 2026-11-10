import type { MetricKey, MetricReading } from "./client";

/** How long each limit window lasts. The endpoint reports only the reset, so the length is assumed. */
export const WINDOW_MS: Record<MetricKey, number> = {
	five_hour: 5 * 3_600_000,
	seven_day: 7 * 86_400_000,
	seven_day_opus: 7 * 86_400_000,
	seven_day_sonnet: 7 * 86_400_000
};

export const METRIC_TITLES: Record<MetricKey, string> = {
	five_hour: "Session",
	seven_day: "Weekly",
	seven_day_opus: "Opus",
	seven_day_sonnet: "Sonnet"
};

export type Forecast = {
	/** Where usage lands at the reset if the pace so far holds, in percent. */
	projected: number;
	/** Percent per day (weekly windows) or per hour (the session window). */
	rate: number;
	rateUnit: "day" | "hr";
	/** When usage reaches 100% at this pace, if before the reset. */
	locksAt: number | null;
	/** How far through the window we are, 0–1: the on-pace mark. */
	elapsed: number;
};

/**
 * A straight-line forecast: the pace so far in this window, carried to its
 * reset. Too early in a window (under 5%) any pace is noise, so there is none.
 */
export function forecast(metric: MetricKey, r: MetricReading, now: number): Forecast | null {
	if (r.resetsAt === null) return null;
	const len = WINDOW_MS[metric];
	const start = r.resetsAt - len;
	const elapsed = Math.min(1, Math.max(0, (now - start) / len));
	if (elapsed < 0.05) return null;
	const perMs = r.utilization / (now - start);
	const projected = r.utilization / elapsed;
	const locksAt = perMs > 0 && projected > 100 ? now + (100 - r.utilization) / perMs : null;
	const day = metric === "five_hour" ? 3_600_000 : 86_400_000;
	return {
		projected,
		rate: perMs * day,
		rateUnit: metric === "five_hour" ? "hr" : "day",
		locksAt: locksAt !== null && locksAt < r.resetsAt ? locksAt : null,
		elapsed
	};
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Oct" for a date days away, "14:30" for one later today. */
export function shortWhen(at: number, now: number): string {
	const d = new Date(at);
	if (at - now < 20 * 3_600_000 && d.getDate() === new Date(now).getDate()) {
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	}
	return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "2h 36m", "36m", "3d 4h" until a reset. */
export function countdown(at: number, now: number): string {
	const m = Math.max(0, Math.round((at - now) / 60_000));
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h}h ${m % 60}m`;
	return `${Math.floor(h / 24)}d ${h % 24}h`;
}
