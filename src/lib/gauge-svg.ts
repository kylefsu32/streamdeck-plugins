/**
 * Pure SVG rendering for the key canvas (144x144). No SDK or network imports so
 * the module can also be exercised by scripts/render-preview.mjs.
 *
 * The Stream Deck key renderer does not reliably support <linearGradient> (it
 * ignores it or posterizes it into bands), so every "gradient" here is built
 * from small flat-color segments: arc sweeps from short stroked arc paths,
 * bar gradients from sliced rectangles under rounded end caps.
 */

export type GaugeSpec = {
	/** Short label, e.g. "5-HR", used in bar rows and the arc center. */
	labelShort: string;
	/** Long label, e.g. "SESSION (5H)", used under the arc. */
	labelLong: string;
	/** 0-100, or null when the metric is unavailable. */
	pct: number | null;
	/** Pre-formatted time-until-reset, e.g. "2h 14m", or null to omit. */
	resetText: string | null;
};

export type KeyRender = {
	gauges: GaugeSpec[];
	/** Short status line drawn at the bottom, used for error states. */
	message?: string;
};

export type TextOptions = {
	/** Show the percentage number. */
	showPct: boolean;
	/** Show the gauge label (session type). */
	showLabel: boolean;
	/** Show the time-until-reset line. */
	showReset: boolean;
};

export type ColorOptions = {
	/** Key background, #rrggbb. */
	bg: string;
	/** threshold = green/amber/red by usage; custom = colorA; gradient = colorA to colorB. */
	mode: "threshold" | "custom" | "gradient";
	colorA: string;
	colorB: string;
};

export const DEFAULT_COLORS: ColorOptions = {
	bg: "#16161d",
	mode: "threshold",
	colorA: "#43b581",
	colorB: "#e5484d"
};

const OK = "#43b581";
const WARN = "#f0a020";
const HIGH = "#e5484d";
const DIM_FILL = "#6e6e7a";
const FONT = "'SF Pro Display','Segoe UI',Helvetica,Arial,sans-serif";

const BAR_X = 14;
const BAR_W = 116;
const BAR_H = 14;

/* ---------- color utilities ---------- */

function parseHex(hex: string): [number, number, number] | null {
	const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const v = parseInt(m[1], 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toHex(r: number, g: number, b: number): string {
	const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
	return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear interpolation between two #rrggbb colors; falls back to `a` on bad input. */
export function mixColor(a: string, b: string, t: number): string {
	const ca = parseHex(a);
	const cb = parseHex(b);
	if (!ca || !cb) return a;
	return toHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
}

/** Validate a user-provided color; anything but #rrggbb falls back. */
export function sanitizeColor(v: unknown, fallback: string): string {
	return typeof v === "string" && parseHex(v) ? v.trim().toLowerCase() : fallback;
}

function luminance(hex: string): number {
	const c = parseHex(hex);
	if (!c) return 0;
	return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

type Palette = { text: string; muted: string; dim: string; track: string };

/** Text and track colors derived from the background so light backgrounds stay legible. */
function palette(bg: string): Palette {
	const light = luminance(bg) > 0.5;
	return light
		? { text: "#1a1a20", muted: "#4d4d58", dim: "#6e6e78", track: mixColor(bg, "#000000", 0.14) }
		: { text: "#f2f2f5", muted: "#9a9aa6", dim: "#6e6e7a", track: mixColor(bg, "#ffffff", 0.12) };
}

function fillColor(pct: number): string {
	if (pct >= 90) return HIGH;
	if (pct >= 70) return WARN;
	return OK;
}

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Takes the already-rounded display value so text, color, and fill always agree. */
function pctText(shown: number | null): string {
	return shown === null ? "--" : `${shown}%`;
}

function rounded(pct: number | null): { raw: number; shown: number | null } {
	const raw = pct === null ? 0 : Math.max(0, Math.min(100, pct));
	return { raw, shown: pct === null ? null : Math.round(raw) };
}

/** Flat fill color for a gauge in non-gradient modes. */
function flatFill(shown: number, colors: ColorOptions): string {
	return colors.mode === "custom" || colors.mode === "gradient" ? colors.colorA : fillColor(shown);
}

/* ---------- bars ---------- */

/**
 * Bar fill. In gradient mode the fill is sliced: a tip-colored pill underneath
 * provides the rounded right cap, a colorA pill the left cap, and flat slices
 * interpolate between them. Gradient position maps to the FULL track width, so
 * the tip color doubles as a fill-level indicator.
 */
function barFillSvg(barY: number, fillW: number, shown: number, colors: ColorOptions): string {
	const color = flatFill(shown, colors);
	// Below BAR_H the pill cannot show two caps and stays pure colorA; at
	// exactly BAR_H the left cap covers the tip pill, so the transition into
	// the sliced branch is pixel-continuous with no color pop.
	if (colors.mode !== "gradient" || fillW < BAR_H) {
		return `<rect x="${BAR_X}" y="${barY}" width="${fillW.toFixed(1)}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${colors.mode === "gradient" ? colors.colorA : color}"/>`;
	}
	const tip = mixColor(colors.colorA, colors.colorB, fillW / BAR_W);
	let s = `<rect x="${BAR_X}" y="${barY}" width="${fillW.toFixed(1)}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${tip}"/>`;
	s += `<rect x="${BAR_X}" y="${barY}" width="${BAR_H}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${colors.colorA}"/>`;
	const from = BAR_X + BAR_H / 2;
	const to = BAR_X + fillW - BAR_H / 2;
	const n = Math.max(2, Math.ceil((to - from) / 6));
	const step = (to - from) / n;
	for (let i = 0; i < n; i++) {
		const x0 = from + i * step;
		const t = (x0 + step / 2 - BAR_X) / BAR_W;
		s += `<rect x="${x0.toFixed(1)}" y="${barY}" width="${(step + 0.7).toFixed(1)}" height="${BAR_H}" fill="${mixColor(colors.colorA, colors.colorB, t)}"/>`;
	}
	return s;
}

/**
 * One horizontal bar gauge block. `top` is the label baseline when a label row
 * is present, otherwise the bar's top edge.
 */
function bar(g: GaugeSpec, top: number, text: TextOptions, showResetLine: boolean, colors: ColorOptions, pal: Palette): string {
	const labelRow = text.showLabel || text.showPct;
	const barY = labelRow ? top + 8 : top;
	const resetBase = barY + BAR_H + 14;
	// The rounded value drives text, color, and whether any fill is drawn, so a
	// key can never read "0%" while showing a fill nub, or disagree with a
	// sibling key's color at the 70/90 boundaries. Raw value only sets geometry.
	const { raw, shown } = rounded(g.pct);
	const fillW = shown === null || shown === 0 ? 0 : Math.max(4, (raw / 100) * BAR_W);

	let s = "";
	if (labelRow && text.showLabel) {
		s += `<text x="${BAR_X}" y="${top}" font-family=${JSON.stringify(FONT)} font-size="15" font-weight="600" fill="${pal.muted}">${esc(g.labelShort)}</text>`;
	}
	if (labelRow && text.showPct) {
		s += `<text x="${BAR_X + BAR_W}" y="${top}" text-anchor="end" font-family=${JSON.stringify(FONT)} font-size="16" font-weight="700" fill="${pal.text}">${pctText(shown)}</text>`;
	}
	s += `<rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${pal.track}"/>`;
	if (fillW > 0 && shown !== null) {
		s += barFillSvg(barY, fillW, shown, colors);
	}
	if (showResetLine && g.resetText) {
		s += `<text x="${BAR_X}" y="${resetBase}" font-family=${JSON.stringify(FONT)} font-size="11" fill="${pal.dim}">${esc(g.resetText)}</text>`;
	}
	return s;
}

/**
 * Anchor positions for the two bar blocks by visible-row combination, all
 * verified against the ~12px bezel-occluded border of the 144px canvas.
 */
function barTops(labelRow: boolean, reset: boolean, message: boolean): [number, number] {
	if (message) return labelRow ? [30, 88] : [40, 74];
	if (labelRow && reset) return [26, 90];
	if (labelRow) return [38, 96];
	if (reset) return [36, 84];
	return [48, 84];
}

/* ---------- arc ---------- */

/**
 * Gradient endpoint colors for the arc sweep by mode. In gradient mode the
 * endpoint is scaled by fill level so the gradient anchors to the full circle
 * (matching the bars, whose gradient anchors to the full track): a 5% arc ends
 * barely past colorA instead of compressing the whole span into the nub.
 */
function arcStops(shown: number, raw: number, colors: ColorOptions): { from: string; to: string } {
	if (colors.mode === "gradient") {
		return { from: colors.colorA, to: mixColor(colors.colorA, colors.colorB, raw / 100) };
	}
	const base = colors.mode === "custom" ? colors.colorA : fillColor(shown);
	return { from: mixColor(base, "#000000", 0.45), to: base };
}

/**
 * The progress sweep as flat-color arc segments (the renderer cannot be
 * trusted with real gradients). Small circles at both ends stand in for
 * round line caps.
 */
function arcSweep(cx: number, cy: number, r: number, stroke: number, raw: number, from: string, to: string): string {
	const sweep = (raw / 100) * 2 * Math.PI;
	const a0 = -Math.PI / 2;
	const point = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
	const n = Math.max(2, Math.ceil((raw / 100) * 36));
	const seg = sweep / n;
	const full = raw >= 100;
	// Slight overlap hides the seams between flat-colored segments; on a full
	// circle the final seam at 12 o'clock gets the same treatment.
	const overlap = Math.min(seg * 0.35, 0.03);

	let s = "";
	for (let i = 0; i < n; i++) {
		const s0 = a0 + i * seg;
		const s1 = a0 + (i + 1) * seg + (i === n - 1 && !full ? 0 : overlap);
		const color = mixColor(from, to, (i + 0.5) / n);
		const large = s1 - s0 > Math.PI ? 1 : 0;
		s += `<path d="M ${point(s0)} A ${r} ${r} 0 ${large} 1 ${point(s1)}" fill="none" stroke="${color}" stroke-width="${stroke}"/>`;
	}
	// Round end caps; a closed ring needs none, and a cap drawn at 12 o'clock
	// would overpaint the opposite end of the sweep.
	if (!full) {
		const cap = stroke / 2;
		const capAt = (a: number, color: string) =>
			`<circle cx="${(cx + r * Math.cos(a)).toFixed(2)}" cy="${(cy + r * Math.sin(a)).toFixed(2)}" r="${cap}" fill="${color}"/>`;
		s += capAt(a0, from);
		s += capAt(a0 + sweep, to);
	}
	return s;
}

/** Single large arc gauge. */
function arc(g: GaugeSpec, text: TextOptions, showResetLine: boolean, colors: ColorOptions, pal: Palette): string {
	// The hardware bezel/diffuser eats roughly the outer 12px of the 144px
	// canvas, so the arc and bottom text stay inside that inset.
	const cx = 72;
	const cy = 60;
	const r = 40;
	const stroke = 11;
	const { raw, shown } = rounded(g.pct);

	let s = "";
	s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${pal.track}" stroke-width="${stroke}"/>`;
	if (shown !== null && shown > 0) {
		const { from, to } = arcStops(shown, raw, colors);
		s += arcSweep(cx, cy, r, stroke, raw, from, to);
	}
	if (text.showPct) {
		s += `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="26" font-weight="700" fill="${pal.text}">${pctText(shown)}</text>`;
	} else if (text.showLabel) {
		// With the percentage hidden, the short label takes the ring center.
		s += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="14" font-weight="600" fill="${pal.muted}">${esc(g.labelShort)}</text>`;
	}
	if (text.showPct && text.showLabel) {
		s += `<text x="${cx}" y="116" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="13" font-weight="600" fill="${pal.muted}">${esc(g.labelLong)}</text>`;
	}
	if (showResetLine && g.resetText) {
		s += `<text x="${cx}" y="129" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="11" fill="${pal.dim}">${esc(g.resetText)}</text>`;
	}
	return s;
}

/* ---------- entry ---------- */

/** Render the full 144x144 key image. */
export function renderKeySvg(render: KeyRender, text: TextOptions, colors: ColorOptions = DEFAULT_COLORS): string {
	const pal = palette(colors.bg);
	// Reset rows are reserved from the toggle alone, not from whether resetText
	// is present: the cold-start paint (null cache) and the post-fetch repaint
	// must not shift geometry. A null resets_at from the API leaves the row
	// empty, which is the acceptable edge of that trade.
	const resetVisible = text.showReset && !render.message;
	let body = "";
	if (render.gauges.length === 1) {
		body = arc(render.gauges[0], text, resetVisible, colors, pal);
	} else {
		const labelRow = text.showLabel || text.showPct;
		const tops = barTops(labelRow, resetVisible, Boolean(render.message));
		body = render.gauges
			.slice(0, 2)
			.map((g, i) => bar(g, tops[i], text, resetVisible, colors, pal))
			.join("");
	}
	// Baseline 129 keeps descenders (~3px) above the ~12px bezel-occluded band.
	const message = render.message
		? `<text x="72" y="129" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="12" font-weight="600" fill="${WARN}">${esc(render.message)}</text>`
		: "";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="${colors.bg}"/>${body}${message}</svg>`;
}

/** Format milliseconds-until-reset as a compact countdown. */
export function formatCountdown(msLeft: number): string {
	if (msLeft <= 0) return "resetting";
	const mins = Math.ceil(msLeft / 60000);
	const days = Math.floor(mins / 1440);
	const hours = Math.floor((mins % 1440) / 60);
	const rem = mins % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${rem}m`;
	return `${rem}m`;
}
