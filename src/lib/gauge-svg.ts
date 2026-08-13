/**
 * Pure SVG rendering for the key canvas (144x144). No SDK or network imports so
 * the module can also be exercised by scripts/render-preview.mjs.
 */

export type GaugeSpec = {
	/** Short label drawn next to the gauge, e.g. "5-HR" or "WEEK". */
	label: string;
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

const BG = "#16161d";
const TRACK = "#2e2e3a";
const TEXT = "#f2f2f5";
const MUTED = "#9a9aa6";
const DIM = "#6e6e7a";
const OK = "#43b581";
const WARN = "#f0a020";
const HIGH = "#e5484d";
const FONT = "'SF Pro Display','Segoe UI',Helvetica,Arial,sans-serif";

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

/** One horizontal bar gauge with its label row above and optional reset line below. */
function bar(g: GaugeSpec, top: number, showReset: boolean): string {
	const x = 14;
	const w = 116;
	const h = 14;
	const labelY = top;
	const barY = top + 8;
	const resetY = barY + h + 14;
	// The rounded value drives text, color, and whether any fill is drawn, so a
	// key can never read "0%" while showing a fill nub, or disagree with a
	// sibling key's color at the 70/90 boundaries. Raw value only sets geometry.
	const raw = g.pct === null ? 0 : Math.max(0, Math.min(100, g.pct));
	const shown = g.pct === null ? null : Math.round(raw);
	const fillW = shown === null || shown === 0 ? 0 : Math.max(4, (raw / 100) * w);
	const color = shown === null ? DIM : fillColor(shown);

	let s = "";
	s += `<text x="${x}" y="${labelY}" font-family=${JSON.stringify(FONT)} font-size="15" font-weight="600" fill="${MUTED}">${esc(g.label)}</text>`;
	s += `<text x="${x + w}" y="${labelY}" text-anchor="end" font-family=${JSON.stringify(FONT)} font-size="16" font-weight="700" fill="${TEXT}">${pctText(shown)}</text>`;
	s += `<rect x="${x}" y="${barY}" width="${w}" height="${h}" rx="${h / 2}" fill="${TRACK}"/>`;
	if (fillW > 0) {
		s += `<rect x="${x}" y="${barY}" width="${fillW.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color}"/>`;
	}
	if (showReset && g.resetText) {
		s += `<text x="${x}" y="${resetY}" font-family=${JSON.stringify(FONT)} font-size="11" fill="${DIM}">${esc(g.resetText)}</text>`;
	}
	return s;
}

/** Single large arc gauge with centered percentage. */
function arc(g: GaugeSpec, showReset: boolean): string {
	// The hardware bezel/diffuser eats roughly the outer 12px of the 144px
	// canvas, so the arc and bottom text stay inside that inset.
	const cx = 72;
	const cy = 60;
	const r = 40;
	const stroke = 11;
	const c = 2 * Math.PI * r;
	const raw = g.pct === null ? 0 : Math.max(0, Math.min(100, g.pct));
	const shown = g.pct === null ? null : Math.round(raw);
	const color = shown === null ? DIM : fillColor(shown);

	let s = "";
	s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${stroke}"/>`;
	if (shown !== null && shown > 0) {
		const dash = (raw / 100) * c;
		s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
	}
	s += `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="26" font-weight="700" fill="${TEXT}">${pctText(shown)}</text>`;
	s += `<text x="${cx}" y="116" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="13" font-weight="600" fill="${MUTED}">${esc(g.label)}</text>`;
	if (showReset && g.resetText) {
		s += `<text x="${cx}" y="129" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="11" fill="${DIM}">${esc(g.resetText)}</text>`;
	}
	return s;
}

/** Render the full 144x144 key image. */
export function renderKeySvg(render: KeyRender, showReset: boolean): string {
	let body = "";
	const resetVisible = showReset && !render.message;
	if (render.gauges.length === 1) {
		body = arc(render.gauges[0], resetVisible);
	} else {
		// Two bar gauges. With reset lines the blocks are taller; with an error
		// message the blocks shift up to leave room at the bottom.
		const tops = render.message ? [30, 88] : resetVisible ? [26, 90] : [38, 96];
		body = render.gauges
			.slice(0, 2)
			.map((g, i) => bar(g, tops[i], resetVisible))
			.join("");
	}
	// Baseline 129 keeps descenders (~3px) above the ~12px bezel-occluded band.
	const message = render.message
		? `<text x="72" y="129" text-anchor="middle" font-family=${JSON.stringify(FONT)} font-size="12" font-weight="600" fill="${WARN}">${esc(render.message)}</text>`
		: "";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="${BG}"/>${body}${message}</svg>`;
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
