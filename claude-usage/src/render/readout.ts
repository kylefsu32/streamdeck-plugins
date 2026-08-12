/**
 * Text-only key face, shown while a key is pressed.
 *
 * With the rings gone the whole 144px canvas is available, so the numbers get
 * roughly twice the size they could manage inside the rings' centre hole. Values
 * keep the colour of the ring they replace, so a pressed key is still
 * identifiable at a glance.
 */

import { escapeXml, FONT, rgb, type RGB } from "./rings";

export type ReadoutRow = {
	/** The number itself, e.g. "46%" or "19.3M". */
	value: string;
	/** Short caption above it, e.g. "5H" or "FABLE". */
	label: string;
	colour: RGB;
};

export type ReadoutOptions = {
	size?: number;
	background?: RGB;
	rows: ReadoutRow[];
};

/**
 * Largest size that keeps `text` inside `budget` px. Digits run about 0.56em
 * wide in this family, so this is close enough without measuring glyphs.
 */
function fit(text: string, budget: number, max: number): number {
	const width = Math.max(1, text.length) * 0.56;
	return Math.max(12, Math.min(max, Math.floor(budget / width)));
}

/**
 * `y` is where the text should appear *centred*.
 *
 * Stream Deck rasterises SVG with Qt, which implements SVG Tiny and ignores
 * `dominant-baseline` — so vertical centring has to be done by hand. Shifting
 * the baseline down by ~0.35em puts the cap-height mass on the requested line.
 */
function text(
	x: number,
	y: number,
	content: string,
	options: { size: number; colour: string; weight?: number; opacity?: number; tracking?: number }
): string {
	const opacity = options.opacity === undefined ? "" : ` fill-opacity="${options.opacity}"`;
	const tracking = options.tracking === undefined ? "" : ` letter-spacing="${options.tracking}"`;
	const baseline = Math.round((y + options.size * 0.35) * 100) / 100;
	return (
		`<text x="${x}" y="${baseline}" fill="${options.colour}"${opacity} font-family="${FONT}"` +
		` font-size="${options.size}" font-weight="${options.weight ?? 600}"${tracking}` +
		` text-anchor="middle">${escapeXml(content)}</text>`
	);
}

/** Renders the pressed state and returns a `data:` URI for `setImage`. */
export function renderReadout(options: ReadoutOptions): string {
	const size = options.size ?? 144;
	const cx = size / 2;
	const body: string[] = [];

	if (options.background) {
		body.push(`<rect width="${size}" height="${size}" fill="${rgb(options.background)}"/>`);
	}

	const rows = options.rows.slice(0, 2);

	if (rows.length === 1) {
		const row = rows[0]!;
		body.push(text(cx, 100, row.label, { size: 18, colour: rgb(row.colour), opacity: 0.55, tracking: 1.2 }));
		body.push(text(cx, 62, row.value, { size: fit(row.value, 126, 56), colour: rgb(row.colour), weight: 700 }));
	} else if (rows.length === 2) {
		const [first, second] = rows as [ReadoutRow, ReadoutRow];

		// No divider between the rows — the captions already separate them, and a
		// rule dark enough not to compete is invisible on a black key anyway.
		body.push(text(cx, 26, first.label, { size: 15, colour: rgb(first.colour), opacity: 0.5, tracking: 1 }));
		body.push(text(cx, 53, first.value, { size: fit(first.value, 126, 38), colour: rgb(first.colour), weight: 700 }));

		body.push(text(cx, 96, second.label, { size: 15, colour: rgb(second.colour), opacity: 0.5, tracking: 1 }));
		body.push(text(cx, 123, second.value, { size: fit(second.value, 126, 38), colour: rgb(second.colour), weight: 700 }));
	}

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
		body.join("") +
		"</svg>";

	// URI-encoded, not base64 — see the note in rings.ts.
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
