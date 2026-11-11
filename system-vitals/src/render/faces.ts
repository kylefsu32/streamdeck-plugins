/**
 * Key faces, drawn as SVG and handed to `setImage` as data URIs.
 *
 * Stream Deck rasterises SVG with Qt's SVG Tiny renderer: no CSS, no
 * `dominant-baseline`, no filters. Everything below sticks to plain shapes,
 * `fill-opacity`, linear gradients and `<tspan>`, which it handles reliably.
 */

import { mix, rgb, type RGB, type Theme } from "./theme";

export const SIZE = 144;
export const FONT = "SF Pro Display,-apple-system,Helvetica Neue,Helvetica,Arial,sans-serif";
const PAD = 10;

export type Line = { values: number[]; colour: RGB };

export type Readout = {
	label: string;
	value: string;
	unit?: string;
	/** Second line under the value, e.g. "↑ 1.2 MB/s" or "of 32 GB". */
	sub?: string;
	subColour?: RGB;
	colour: RGB;
};

export type FaceCommon = {
	theme: Theme;
	/** Draws everything at reduced contrast, e.g. a watched app that isn't running. */
	faded?: boolean;
};

export function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function r2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Rough advance width; this family's digits and caps run ~0.6em. */
export function textWidth(text: string, size: number): number {
	let em = 0;
	for (const ch of text) {
		em += /[il.,:;'|!1 ]/.test(ch) ? 0.3 : /[MWmw%]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.62 : 0.55;
	}
	return em * size;
}

/** Largest font size (≤ max) at which `text` fits in `budget` px. */
export function fitSize(text: string, budget: number, max: number, min = 11): number {
	const w = textWidth(text, 1);
	return Math.max(min, Math.min(max, Math.floor(budget / Math.max(w, 0.01))));
}

/** Truncates with an ellipsis so `text` fits `budget` px at `size`. */
export function clip(text: string, budget: number, size: number): string {
	if (textWidth(text, size) <= budget) return text;
	let out = text;
	while (out.length > 1 && textWidth(out + "…", size) > budget) out = out.slice(0, -1);
	return out.trimEnd() + "…";
}

type TextOpts = { size: number; colour: RGB; weight?: number; anchor?: "start" | "middle" | "end"; opacity?: number; tracking?: number };

/** `y` is the visual centre line; Qt ignores dominant-baseline so we shift by hand. */
function text(x: number, y: number, content: string, o: TextOpts, extra = ""): string {
	const baseline = r2(y + o.size * 0.35);
	const op = o.opacity === undefined ? "" : ` fill-opacity="${o.opacity}"`;
	const tr = o.tracking === undefined ? "" : ` letter-spacing="${o.tracking}"`;
	return (
		`<text x="${r2(x)}" y="${baseline}" fill="${rgb(o.colour)}"${op}${tr} font-family="${FONT}" font-size="${o.size}"` +
		` font-weight="${o.weight ?? 600}" text-anchor="${o.anchor ?? "start"}">${escapeXml(content)}${extra}</text>`
	);
}

function frame(t: Theme, body: string, faded = false): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		`<rect width="${SIZE}" height="${SIZE}" fill="${rgb(t.background)}"/>` +
		(faded ? `<g opacity="0.32">${body}</g>` : body) +
		`</svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** Label + value block shared by the graph and number faces. */
function header(t: Theme, r: Readout, valueY: number, maxValueSize: number): string {
	const parts: string[] = [];
	parts.push(text(PAD, 17, r.label.toUpperCase(), { size: 15, colour: t.muted, weight: 700, tracking: 0.6 }));

	const unit = r.unit ?? "";
	const unitSize = 15;
	const budget = SIZE - PAD * 2 - (unit ? textWidth(unit, unitSize) + 4 : 0);
	const size = fitSize(r.value, budget, maxValueSize, 18);
	const unitSpan = unit
		? `<tspan font-size="${unitSize}" font-weight="600" fill="${rgb(t.muted)}"> ${escapeXml(unit)}</tspan>`
		: "";
	parts.push(text(PAD - 1, valueY, r.value, { size, colour: r.colour, weight: 700 }, unitSpan));

	if (r.sub) {
		parts.push(
			text(PAD, valueY + size * 0.5 + 12, clip(r.sub, SIZE - PAD * 2, 14), {
				size: 14,
				colour: r.subColour ?? t.muted,
				weight: 600
			})
		);
	}
	return parts.join("");
}

/**
 * Live tile: label and value on top, a history graph scrolling right-to-left
 * underneath, newest sample on the right edge.
 */
export function renderGraph(
	o: FaceCommon & { readout: Readout; lines: Line[]; max: number; points?: number }
): string {
	const t = o.theme;
	const top = o.readout.sub ? 92 : 78;
	const bottom = SIZE - 4;
	const height = bottom - top;
	const points = Math.max(2, o.points ?? 60);
	const step = SIZE / (points - 1);
	const max = o.max > 0 ? o.max : 1;

	const parts: string[] = [];
	// Faint gridlines at 50% so a flat line still reads as "low", not "broken".
	parts.push(`<line x1="0" y1="${r2(top + height / 2)}" x2="${SIZE}" y2="${r2(top + height / 2)}" stroke="${rgb(t.grid)}" stroke-width="1"/>`);
	parts.push(`<line x1="0" y1="${top}" x2="${SIZE}" y2="${top}" stroke="${rgb(t.grid)}" stroke-width="1" stroke-opacity="0.5"/>`);

	o.lines.forEach((line, index) => {
		const values = line.values.slice(-points);
		const offset = points - values.length;
		// Split at NaN (lost ping, missing reading) so gaps show as gaps.
		const runs: [number, number][][] = [[]];
		values.forEach((v, i) => {
			if (!Number.isFinite(v)) {
				if (runs[runs.length - 1]!.length > 0) runs.push([]);
				return;
			}
			const x = (offset + i) * step;
			const y = bottom - Math.max(0, Math.min(1, v / max)) * height;
			runs[runs.length - 1]!.push([r2(x), r2(y)]);
		});
		const gradId = `g${index}`;
		parts.push(
			`<defs><linearGradient id="${gradId}" x1="0" y1="${top}" x2="0" y2="${bottom}" gradientUnits="userSpaceOnUse">` +
				`<stop offset="0" stop-color="${rgb(line.colour)}" stop-opacity="${index === 0 ? 0.55 : 0.3}"/>` +
				`<stop offset="1" stop-color="${rgb(line.colour)}" stop-opacity="0.04"/></linearGradient></defs>`
		);
		for (const run of runs) {
			if (run.length === 0) continue;
			if (run.length === 1) {
				parts.push(`<circle cx="${run[0]![0]}" cy="${run[0]![1]}" r="2" fill="${rgb(line.colour)}"/>`);
				continue;
			}
			const pts = run.map(([x, y]) => `${x},${y}`).join(" ");
			const first = run[0]!;
			const last = run[run.length - 1]!;
			parts.push(`<polygon points="${first[0]},${bottom} ${pts} ${last[0]},${bottom}" fill="url(#${gradId})"/>`);
			parts.push(
				`<polyline points="${pts}" fill="none" stroke="${rgb(line.colour)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
			);
		}
	});

	parts.push(header(t, o.readout, 48, 40));
	return frame(t, parts.join(""), o.faded);
}

/** Ring gauge with the value in the middle, for anything with a natural 0–100%. */
export function renderGauge(o: FaceCommon & { readout: Readout; fraction: number }): string {
	const t = o.theme;
	const cx = SIZE / 2;
	const cy = 80;
	const radius = 50;
	const width = 11;
	const f = Math.max(0, Math.min(1, Number.isFinite(o.fraction) ? o.fraction : 0));
	// 270° sweep, open at the bottom like a speedometer.
	const start = 0.625;
	const sweep = 0.75;
	const point = (turns: number): [number, number] => {
		const a = turns * Math.PI * 2;
		return [r2(cx + radius * Math.sin(a)), r2(cy - radius * Math.cos(a))];
	};
	const arc = (from: number, to: number): string => {
		const [x0, y0] = point(from);
		const [x1, y1] = point(to);
		const large = to - from > 0.5 ? 1 : 0;
		return `M${x0} ${y0}A${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`;
	};
	const parts: string[] = [];
	parts.push(
		`<path d="${arc(start, start + sweep)}" fill="none" stroke="${rgb(t.grid)}" stroke-width="${width}" stroke-linecap="round"/>`
	);
	if (f > 0.002) {
		parts.push(
			`<path d="${arc(start, start + sweep * f)}" fill="none" stroke="${rgb(o.readout.colour)}" stroke-width="${width}" stroke-linecap="round"/>`
		);
	}
	const valueSize = fitSize(o.readout.value, 2 * radius - width * 2 - 4, 32, 14);
	parts.push(text(cx, cy - 2, o.readout.value, { size: valueSize, colour: t.text, weight: 700, anchor: "middle" }));
	if (o.readout.unit) {
		parts.push(text(cx, cy + valueSize * 0.5 + 8, o.readout.unit, { size: 13, colour: t.muted, weight: 600, anchor: "middle" }));
	}
	parts.push(
		text(cx, SIZE - 14, clip(o.readout.label.toUpperCase(), SIZE - 20, 15), {
			size: 15,
			colour: t.muted,
			weight: 700,
			anchor: "middle",
			tracking: 0.6
		})
	);
	return frame(t, parts.join(""), o.faded);
}

/** Just the number, as big as it will go. */
export function renderNumber(o: FaceCommon & { readout: Readout }): string {
	const t = o.theme;
	const r = o.readout;
	const parts: string[] = [];
	parts.push(
		text(SIZE / 2, 22, clip(r.label.toUpperCase(), SIZE - 16, 16), { size: 16, colour: t.muted, weight: 700, anchor: "middle", tracking: 0.6 })
	);
	const size = fitSize(r.value, SIZE - 16, 54, 18);
	parts.push(text(SIZE / 2, r.sub ? 68 : 74, r.value, { size, colour: r.colour, weight: 700, anchor: "middle" }));
	if (r.unit) {
		parts.push(text(SIZE / 2, (r.sub ? 68 : 74) + size * 0.5 + 12, r.unit, { size: 16, colour: t.muted, weight: 600, anchor: "middle" }));
	}
	if (r.sub) {
		parts.push(text(SIZE / 2, SIZE - 16, clip(r.sub, SIZE - 16, 15), { size: 15, colour: r.subColour ?? t.muted, weight: 600, anchor: "middle" }));
	}
	return frame(t, parts.join(""), o.faded);
}

/** One bar per core, so a single pegged thread is obvious even when the average is low. */
export function renderCores(o: FaceCommon & { label: string; value: string; cores: number[]; colour: RGB }): string {
	const t = o.theme;
	const parts: string[] = [];
	parts.push(text(PAD, 17, o.label.toUpperCase(), { size: 15, colour: t.muted, weight: 700, tracking: 0.6 }));
	parts.push(text(SIZE - PAD, 17, o.value, { size: 17, colour: o.colour, weight: 700, anchor: "end" }));
	const n = Math.max(1, o.cores.length);
	const top = 36;
	const bottom = SIZE - 8;
	const height = bottom - top;
	const gap = n > 16 ? 2 : 3;
	const width = (SIZE - PAD * 2 - gap * (n - 1)) / n;
	o.cores.forEach((v, i) => {
		const x = PAD + i * (width + gap);
		const f = Math.max(0, Math.min(1, v / 100));
		parts.push(`<rect x="${r2(x)}" y="${top}" width="${r2(width)}" height="${height}" rx="2" fill="${rgb(t.grid)}"/>`);
		if (f > 0.005) {
			const h = Math.max(2, height * f);
			const colour = mix(o.colour, [255, 84, 84], Math.max(0, (f - 0.75) / 0.25));
			parts.push(`<rect x="${r2(x)}" y="${r2(bottom - h)}" width="${r2(width)}" height="${r2(h)}" rx="2" fill="${rgb(colour)}"/>`);
		}
	});
	return frame(t, parts.join(""), o.faded);
}

export type ListRow = { name: string; value: string; fraction: number };

/** Top-N list: name on the left, value on the right, a thin usage bar under each. */
export function renderList(o: FaceCommon & { label: string; rows: ListRow[]; colour: RGB }): string {
	const t = o.theme;
	const parts: string[] = [];
	parts.push(text(PAD, 17, o.label.toUpperCase(), { size: 15, colour: t.muted, weight: 700, tracking: 0.6 }));
	const rows = o.rows.slice(0, 5);
	if (rows.length === 0) {
		parts.push(text(SIZE / 2, 80, "—", { size: 30, colour: t.muted, anchor: "middle" }));
		return frame(t, parts.join(""), o.faded);
	}
	const top = 32;
	const rowHeight = Math.min(36, (SIZE - top - 4) / rows.length);
	const nameSize = rows.length <= 2 ? 18 : rows.length === 3 ? 16 : 14;
	rows.forEach((row, i) => {
		const y = top + i * rowHeight + rowHeight * 0.4;
		const valueWidth = textWidth(row.value, nameSize) + 10;
		parts.push(text(SIZE - PAD, y, row.value, { size: nameSize, colour: o.colour, weight: 700, anchor: "end" }));
		parts.push(text(PAD, y, clip(row.name, SIZE - PAD * 2 - valueWidth, nameSize), { size: nameSize, colour: t.text, weight: 600 }));
		const barY = r2(y + nameSize * 0.5 + 3);
		const w = SIZE - PAD * 2;
		parts.push(`<rect x="${PAD}" y="${barY}" width="${w}" height="3" rx="1.5" fill="${rgb(t.grid)}"/>`);
		const f = Math.max(0, Math.min(1, row.fraction));
		if (f > 0.01) {
			parts.push(`<rect x="${PAD}" y="${barY}" width="${r2(w * f)}" height="3" rx="1.5" fill="${rgb(o.colour)}"/>`);
		}
	});
	return frame(t, parts.join(""), o.faded);
}

/** Shown when a reading isn't available on this Mac (e.g. battery on a Mac mini). */
export function renderMessage(o: FaceCommon & { label: string; message: string }): string {
	const t = o.theme;
	return frame(
		t,
		text(SIZE / 2, 22, o.label.toUpperCase(), { size: 16, colour: t.muted, weight: 700, anchor: "middle", tracking: 0.6 }) +
			text(SIZE / 2, 78, clip(o.message, SIZE - 16, 18), { size: 18, colour: t.text, weight: 600, anchor: "middle" }),
		o.faded
	);
}
