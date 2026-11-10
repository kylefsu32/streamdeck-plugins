import { countdown, forecast, METRIC_TITLES, shortWhen } from "../usage/forecast";
import type { MetricKey, UsageSnapshot } from "../usage/client";
import { arc, esc, FONT } from "./svg";

/**
 * The usage keys: a soft dark card, one big number, and Claude's coral for
 * the fill. Flat colours only — the Stream Deck renderer bands or drops
 * gradients (learned in claude-gauges).
 */

const CORAL = "#e07856";
const HOT = "#ef5b4c";
const WHITE = "#f4f1ee";
const GREY = "#a8a29c";
const TRACK = "#3a3735";
const CARD = "#1d1c1b";
const EDGE = "#2c2a29";

function t(x: number, y: number, s: string, size: number, fill: string, weight = 700, anchor = "start"): string {
	return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}

function card(body: string, w = 144, h = 144): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#000"/>
<rect x="5" y="5" width="${w - 10}" height="${h - 10}" rx="${Math.min(24, h / 5)}" fill="${CARD}" stroke="${EDGE}" stroke-width="2"/>
${body}
</svg>`;
}

export type UsageView = { metric: MetricKey; snapshot: UsageSnapshot | null; now: number };

const pct = (n: number) => `${Math.round(n)}%`;
/** The other window, as a dim footnote: "5h 34%" on a weekly key, "Wk 61%" on the session key. */
function companion(v: UsageView): string {
	const other: MetricKey = v.metric === "five_hour" ? "seven_day" : "five_hour";
	const r = v.snapshot?.metrics[other];
	return r ? `${other === "five_hour" ? "5h" : "Wk"} ${pct(r.utilization)}` : "";
}

function reading(v: UsageView) {
	return v.snapshot?.metrics[v.metric];
}

/** Why there is no number: "Sign in", "Offline", "…". */
function problem(v: UsageView): string {
	if (!v.snapshot) return "Loading…";
	const e = v.snapshot.error?.kind;
	if (e === "no-credentials") return "Sign in";
	if (e === "expired") return "Open Claude";
	if (e === "network") return "Offline";
	if (e) return "No data";
	return "No data";
}

/** Title, big percent, reset date, the other window, and a vertical fill bar. */
export function usageBarKey(v: UsageView): string {
	const r = reading(v);
	const title = t(20, 40, METRIC_TITLES[v.metric], 20, WHITE);
	if (!r) return card(title + t(20, 86, problem(v), 18, GREY, 400));
	const fill = Math.max(0, Math.min(1, r.utilization / 100));
	const top = 30;
	const bottom = 124;
	const h = Math.max(8, (bottom - top) * fill);
	const colour = r.utilization >= 90 ? HOT : CORAL;
	return card(
		title +
			t(20, 84, pct(r.utilization), 36, WHITE) +
			(r.resetsAt ? t(20, 108, shortWhen(r.resetsAt, v.now), 17, GREY, 400) : "") +
			t(20, 128, companion(v), 17, GREY, 400) +
			`<rect x="114" y="${top}" width="9" height="${bottom - top}" rx="4.5" fill="${TRACK}"/>` +
			`<rect x="114" y="${bottom - h}" width="9" height="${h}" rx="4.5" fill="${colour}"/>`
	);
}

/** A ring with the percent and time to reset inside. */
export function usageRingKey(v: UsageView): string {
	const r = reading(v);
	const head = t(72, 32, METRIC_TITLES[v.metric], 16, GREY, 700, "middle");
	const cx = 72;
	const cy = 85;
	const radius = 37;
	const track = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${TRACK}" stroke-width="10"/>`;
	if (!r) return card(head + track + t(cx, cy + 6, problem(v), 14, GREY, 400, "middle"));
	const sweep = Math.max(0.5, Math.min(359.5, (r.utilization / 100) * 360));
	const colour = r.utilization >= 90 ? HOT : CORAL;
	return card(
		head +
			track +
			arc(cx, cy, radius, 0, sweep, colour, 10) +
			t(cx, cy + 6, pct(r.utilization), 26, WHITE, 700, "middle") +
			(r.resetsAt ? t(cx, cy + 24, countdown(r.resetsAt, v.now), 13, GREY, 400, "middle") : "")
	);
}

/** Where this window ends up at the current pace, and when it locks if that comes first. */
export function usageForecastKey(v: UsageView): string {
	const r = reading(v);
	const f = r ? forecast(v.metric, r, v.now) : null;
	const hot = !!f?.locksAt;
	const trend = `<path d="M 20 44 L 31 33 L 38 39 L 50 27" fill="none" stroke="${hot ? HOT : CORAL}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M 41 26 L 51 26 L 51 36" fill="none" stroke="${hot ? HOT : CORAL}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
	const head = trend + t(126, 42, METRIC_TITLES[v.metric], 17, GREY, 700, "end");
	if (!r) return card(head + t(20, 90, problem(v), 18, GREY, 400));
	if (!f) return card(head + t(20, 86, pct(r.utilization), 34, WHITE) + t(20, 112, "Too early", 15, GREY, 400));
	const verdict = f.locksAt
		? t(20, 108, `Locks ${shortWhen(f.locksAt, v.now)}`, 17, HOT)
		: t(20, 108, r.resetsAt ? `Resets ${shortWhen(r.resetsAt, v.now)}` : "On pace", 15, GREY, 400);
	const rate = `${f.rate >= 10 ? f.rate.toFixed(0) : f.rate.toFixed(1)}%/${f.rateUnit}`;
	return card(head + t(20, 86, pct(f.projected), 34, WHITE) + verdict + t(20, 128, rate, 15, GREY, 400));
}

/** The Stream Deck + touch strip: 200 × 100 per dial. */
export function usageStrip(v: UsageView): string {
	const r = reading(v);
	const w = 200;
	const h = 100;
	const title = t(16, 36, METRIC_TITLES[v.metric], 20, WHITE);
	if (!r) return card(title + t(16, 74, problem(v), 16, GREY, 400), w, h);
	const sub = [r.resetsAt ? shortWhen(r.resetsAt, v.now) : "", companion(v)].filter(Boolean).join(" · ");
	const fill = Math.max(0, Math.min(1, r.utilization / 100));
	const colour = r.utilization >= 90 ? HOT : CORAL;
	return card(
		title +
			t(184, 42, pct(r.utilization), 30, WHITE, 700, "end") +
			t(16, 78, sub, 14, GREY, 400) +
			`<rect x="128" y="70" width="56" height="8" rx="4" fill="${TRACK}"/>` +
			`<rect x="128" y="70" width="${Math.max(8, 56 * fill)}" height="8" rx="4" fill="${colour}"/>`,
		w,
		h
	);
}
