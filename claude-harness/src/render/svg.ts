/**
 * SVG primitives for 144 × 144 key art.
 *
 * Stream Deck rasterises SVG with Qt, which implements SVG Tiny: no
 * dominant-baseline, no CSS, no filters. Text is placed by baseline, and the
 * image goes to setImage as a URI-encoded data URL (base64 SVG is dropped).
 * Both lessons came from the claude-usage plugin next door.
 */

export const SIZE = 144;
export const FONT = "Helvetica, Arial, sans-serif";

export const COLOURS = {
	bg: "#000000",
	panel: "#151518",
	ink: "#f2f2f5",
	dim: "#9a9aa6",
	faint: "#5a5a66",
	track: "#2a2a30",
	working: "#d97757", // Claude's coral
	asking: "#f5b83d",
	done: "#4ade80",
	error: "#f87171",
	idle: "#8a8a99",
	asleep: "#4a4a55"
} as const;

export function esc(text: string): string {
	return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function dataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The tile every key sits on: black corners, a dark rounded panel and a state-coloured top bar. */
export function frame(accent: string, body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<rect width="${SIZE}" height="${SIZE}" fill="${COLOURS.bg}"/>
<rect width="${SIZE}" height="${SIZE}" rx="18" fill="${COLOURS.panel}"/>
<rect width="${SIZE}" height="9" fill="${accent}"/>
${body}
</svg>`;
}

type TextOpts = {
	size?: number;
	weight?: 400 | 700;
	fill?: string;
	anchor?: "start" | "middle" | "end";
	opacity?: number;
};

export function text(x: number, y: number, content: string, o: TextOpts = {}): string {
	const { size = 16, weight = 400, fill = COLOURS.ink, anchor = "middle", opacity } = o;
	const op = opacity === undefined ? "" : ` opacity="${opacity}"`;
	return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${op}>${esc(content)}</text>`;
}

/** Rough Helvetica advance: good enough to keep text inside 144 px without a font engine. */
const NARROW = new Set("iIl.,:;'|!() ·");
const WIDE = new Set("MWmw@%");
export function textWidth(s: string, size: number, bold = false): number {
	let em = 0;
	for (const ch of s) em += NARROW.has(ch) ? 0.3 : WIDE.has(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.66 : 0.54;
	return em * size * (bold ? 1.06 : 1);
}

export function truncate(s: string, maxWidth: number, size: number, bold = false): string {
	if (textWidth(s, size, bold) <= maxWidth) return s;
	let out = s;
	while (out.length > 1 && textWidth(`${out}…`, size, bold) > maxWidth) out = out.slice(0, -1);
	return `${out.trimEnd()}…`;
}

/** Greedy word wrap into at most `lines` lines; the last one gets an ellipsis if text is left over. */
export function wrap(s: string, maxWidth: number, size: number, lines: number, bold = false): string[] {
	const all: string[] = [];
	let line = "";
	for (const word of s.split(/\s+/).filter(Boolean)) {
		const candidate = line ? `${line} ${word}` : word;
		if (textWidth(candidate, size, bold) <= maxWidth) line = candidate;
		else {
			if (line) all.push(line);
			line = textWidth(word, size, bold) <= maxWidth ? word : truncate(word, maxWidth, size, bold);
		}
	}
	if (line) all.push(line);
	if (all.length <= lines) return all;
	const out = all.slice(0, lines);
	let last = out[lines - 1]!;
	while (last.length > 1 && textWidth(`${last}\u2026`, size, bold) > maxWidth) last = last.slice(0, -1);
	out[lines - 1] = `${last.trimEnd()}\u2026`;
	return out;
}

export function lines(x: number, y: number, rows: string[], lineHeight: number, o: TextOpts = {}): string {
	return rows.map((row, i) => text(x, y + i * lineHeight, row, o)).join("");
}

/** A circular arc from angle a0 to a1 (degrees, 0 = 12 o'clock, clockwise). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, stroke: string, width: number): string {
	const rad = (a: number) => ((a - 90) * Math.PI) / 180;
	const x0 = cx + r * Math.cos(rad(a0));
	const y0 = cy + r * Math.sin(rad(a0));
	const x1 = cx + r * Math.cos(rad(a1));
	const y1 = cy + r * Math.sin(rad(a1));
	const large = a1 - a0 > 180 ? 1 : 0;
	return `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

export function circle(cx: number, cy: number, r: number, fill: string, extra = ""): string {
	return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${extra}/>`;
}

export function ring(cx: number, cy: number, r: number, stroke: string, width: number): string {
	return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
}
