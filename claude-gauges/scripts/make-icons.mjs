// Generates all manifest PNGs (plugin icon, category icon, action icon, default
// key image) as simple gauge glyphs. Pure JS via pngjs; no native deps.
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "com.kylefsu32.claude-gauges.sdPlugin");

const BG = [0x16, 0x16, 0x1d, 255];
const TRACK = [0x2e, 0x2e, 0x3a, 255];
const GREEN = [0x43, 0xb5, 0x81, 255];
const AMBER = [0xf0, 0xa0, 0x20, 255];
const WHITE = [0xdf, 0xdf, 0xdf, 255];
const WHITE_DIM = [0xdf, 0xdf, 0xdf, 96];

/** Coverage of a pixel against a rounded rect, sampled on a 3x3 subgrid. */
function roundedRectCoverage(px, py, x, y, w, h, r) {
	let hits = 0;
	for (let sy = 0; sy < 3; sy++) {
		for (let sx = 0; sx < 3; sx++) {
			const cx = px + (sx + 0.5) / 3;
			const cy = py + (sy + 0.5) / 3;
			if (cx < x || cx > x + w || cy < y || cy > y + h) continue;
			const nx = Math.max(x + r - cx, cx - (x + w - r), 0);
			const ny = Math.max(y + r - cy, cy - (y + h - r), 0);
			if (nx * nx + ny * ny <= r * r) hits++;
		}
	}
	return hits / 9;
}

function blend(png, px, py, color, coverage) {
	if (coverage <= 0) return;
	const idx = (png.width * py + px) << 2;
	const a = (color[3] / 255) * coverage;
	const inv = 1 - a;
	const dstA = png.data[idx + 3] / 255;
	const outA = a + dstA * inv;
	if (outA === 0) return;
	for (let c = 0; c < 3; c++) {
		png.data[idx + c] = Math.round((color[c] * a + png.data[idx + c] * dstA * inv) / outA);
	}
	png.data[idx + 3] = Math.round(outA * 255);
}

function fillRoundedRect(png, x, y, w, h, r, color) {
	const x0 = Math.max(0, Math.floor(x) - 1);
	const y0 = Math.max(0, Math.floor(y) - 1);
	const x1 = Math.min(png.width - 1, Math.ceil(x + w) + 1);
	const y1 = Math.min(png.height - 1, Math.ceil(y + h) + 1);
	for (let py = y0; py <= y1; py++) {
		for (let px = x0; px <= x1; px++) {
			blend(png, px, py, color, roundedRectCoverage(px, py, x, y, w, h, r));
		}
	}
}

/** Two stacked bar gauges scaled to size s. tile=true draws a dark rounded tile behind. */
function gauge(s, { tile, fills }) {
	const png = new PNG({ width: s, height: s });
	if (tile) {
		fillRoundedRect(png, 0, 0, s, s, s * 0.22, BG);
	}
	const barW = s * 0.7;
	const barH = s * 0.16;
	const x = (s - barW) / 2;
	const r = barH / 2;
	const rows = [s * 0.3, s * 0.56];
	fills.forEach(([track, fill, frac], i) => {
		fillRoundedRect(png, x, rows[i], barW, barH, r, track);
		if (frac > 0) fillRoundedRect(png, x, rows[i], Math.max(barH, barW * frac), barH, r, fill);
	});
	return PNG.sync.write(png);
}

function save(rel, buf) {
	const path = join(root, rel);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, buf);
	console.log("wrote", rel);
}

const colorFills = [
	[TRACK, GREEN, 0.62],
	[TRACK, AMBER, 0.85]
];
const monoFills = [
	[WHITE_DIM, WHITE, 1],
	[WHITE_DIM, WHITE, 0.6]
];

// Plugin (marketplace) icon: dark tile with colored gauges.
save("imgs/plugin/icon.png", gauge(256, { tile: true, fills: colorFills }));
save("imgs/plugin/icon@2x.png", gauge(512, { tile: true, fills: colorFills }));

// Category icon: monochrome glyph on transparent.
save("imgs/plugin/category.png", gauge(28, { tile: false, fills: monoFills }));
save("imgs/plugin/category@2x.png", gauge(56, { tile: false, fills: monoFills }));

// Action list icon: monochrome glyph on transparent.
save("imgs/actions/gauge/icon.png", gauge(20, { tile: false, fills: monoFills }));
save("imgs/actions/gauge/icon@2x.png", gauge(40, { tile: false, fills: monoFills }));

// Default key image: colored gauges on dark background (square; hardware rounds corners).
save("imgs/actions/gauge/key.png", gauge(72, { tile: true, fills: colorFills }));
save("imgs/actions/gauge/key@2x.png", gauge(144, { tile: true, fills: colorFills }));
