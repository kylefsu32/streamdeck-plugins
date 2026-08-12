/**
 * Activity-ring renderer.
 *
 * Draws Apple Watch style concentric rings as an SVG data URI. SVG has no
 * angular gradient, so each arc is emitted as a series of round-capped
 * segments with interpolated colours — the caps overlap, so the joins are
 * invisible and the stroke genuinely brightens towards its leading end.
 */

export type RingSpec = {
	/** 0..n. Values above 1 draw a full ring plus an overshoot arc. */
	value: number;
	/** Outer-to-inner ordering is the caller's business; this is the radius. */
	radius: number;
	width: number;
	dim: RGB;
	lit: RGB;
	/** Colour used once value exceeds 1. */
	over?: RGB;
};

export type RGB = readonly [number, number, number];

export type RingsOptions = {
	size?: number;
	rings: RingSpec[];
	/** Solid background. Omit for transparent. */
	background?: RGB;
};

const SEGMENT_DEGREES = 9;

export const FONT = "-apple-system,SF Pro Display,Helvetica Neue,Helvetica,Arial,sans-serif";

export function rgb([r, g, b]: RGB): string {
	return `rgb(${r},${g},${b})`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
	const c = Math.max(0, Math.min(1, t));
	return [
		Math.round(a[0] + (b[0] - a[0]) * c),
		Math.round(a[1] + (b[1] - a[1]) * c),
		Math.round(a[2] + (b[2] - a[2]) * c)
	];
}

function pointOn(cx: number, cy: number, r: number, turns: number): [number, number] {
	const a = turns * Math.PI * 2;
	return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** Arc path from `fromTurns` to `toTurns`, clockwise from 12 o'clock. */
function arc(cx: number, cy: number, r: number, fromTurns: number, toTurns: number): string {
	const [x0, y0] = pointOn(cx, cy, r, fromTurns);
	const [x1, y1] = pointOn(cx, cy, r, toTurns);
	const large = toTurns - fromTurns > 0.5 ? 1 : 0;
	return `M${round(x0)} ${round(y0)}A${round(r)} ${round(r)} 0 ${large} 1 ${round(x1)} ${round(y1)}`;
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}

function ringSvg(cx: number, cy: number, spec: RingSpec): string {
	const parts: string[] = [];
	const track = mix(spec.dim, [0, 0, 0], 0.55);

	// Track: a full circle behind the arc.
	parts.push(
		`<circle cx="${cx}" cy="${cy}" r="${round(spec.radius)}" fill="none" stroke="${rgb(track)}" stroke-width="${round(spec.width)}"/>`
	);

	const value = Math.max(0, spec.value);
	if (value <= 0) {
		return parts.join("");
	}

	const filled = Math.min(value, 1);
	const lit = value > 1 && spec.over ? spec.over : spec.lit;
	const dim = value > 1 && spec.over ? mix(spec.over, [0, 0, 0], 0.35) : spec.dim;

	const totalDegrees = filled * 360;
	const steps = Math.max(1, Math.ceil(totalDegrees / SEGMENT_DEGREES));

	for (let i = 0; i < steps; i += 1) {
		const from = (i / steps) * filled;
		const to = ((i + 1) / steps) * filled;
		const colour = mix(dim, lit, (i + 1) / steps);
		parts.push(
			`<path d="${arc(cx, cy, spec.radius, from, to)}" fill="none" stroke="${rgb(colour)}" stroke-width="${round(spec.width)}" stroke-linecap="round"/>`
		);
	}

	// Overshoot: a thinner arc riding on top, the way the Watch wraps past 100%.
	if (value > 1) {
		const extra = Math.min(value - 1, 1);
		const overColour = spec.over ?? spec.lit;
		const inner = spec.width * 0.42;
		const overSteps = Math.max(1, Math.ceil(extra * 360 / SEGMENT_DEGREES));
		for (let i = 0; i < overSteps; i += 1) {
			const from = (i / overSteps) * extra;
			const to = ((i + 1) / overSteps) * extra;
			const colour = mix([255, 255, 255], overColour, (i + 1) / overSteps);
			parts.push(
				`<path d="${arc(cx, cy, spec.radius, from, to)}" fill="none" stroke="${rgb(colour)}" stroke-width="${round(inner)}" stroke-linecap="round"/>`
			);
		}
	}

	return parts.join("");
}

/** Renders the rings and returns a `data:` URI suitable for `setImage`. */
export function renderRings(options: RingsOptions): string {
	const size = options.size ?? 144;
	const cx = size / 2;
	const cy = size / 2;

	const body: string[] = [];
	if (options.background) {
		body.push(`<rect width="${size}" height="${size}" fill="${rgb(options.background)}"/>`);
	}

	for (const spec of options.rings) {
		body.push(ringSvg(cx, cy, spec));
	}

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
		body.join("") +
		"</svg>";

	// Stream Deck takes SVG as a URI-encoded data URL, not base64. Base64 is for
	// the raster formats; passing SVG that way renders nothing at all.
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Ring geometry for a 144px canvas, shared so every key lines up.
 *
 * Widths and radii are chosen to leave a ~70px hole in the middle: enough for a
 * five-character readout without the type touching the inner ring.
 */
export const GEOMETRY = {
	/** Outer ring of a two-ring key. */
	outer: { radius: 59, width: 13 },
	/** Inner ring of a two-ring key. */
	inner: { radius: 42, width: 13 },
	/** Single ring, slightly heavier since it stands alone. */
	solo: { radius: 59, width: 15 }
} as const;

/**
 * Ring colours. Each key gets its own so a wall of single-ring keys stays
 * readable at a glance — coral for the session, teal for the week, and the rest
 * for whatever you split out (a per-model key, a per-project key).
 */
export const RING_COLOURS = {
	coral: { dim: [168, 62, 40] as RGB, lit: [255, 138, 106] as RGB, over: [255, 61, 61] as RGB },
	teal: { dim: [22, 122, 114] as RGB, lit: [94, 234, 212] as RGB, over: [255, 176, 32] as RGB },
	violet: { dim: [88, 60, 160] as RGB, lit: [178, 148, 255] as RGB, over: [255, 61, 61] as RGB },
	amber: { dim: [150, 100, 20] as RGB, lit: [255, 196, 90] as RGB, over: [255, 61, 61] as RGB },
	green: { dim: [42, 120, 52] as RGB, lit: [126, 231, 135] as RGB, over: [255, 61, 61] as RGB },
	blue: { dim: [30, 95, 165] as RGB, lit: [110, 180, 255] as RGB, over: [255, 61, 61] as RGB }
} as const;

export type ColourName = keyof typeof RING_COLOURS;

export function colour(name: string | undefined, fallback: ColourName): (typeof RING_COLOURS)[ColourName] {
	if (name && name in RING_COLOURS) {
		return RING_COLOURS[name as ColourName];
	}
	return RING_COLOURS[fallback];
}

/** Palette shared by the actions so the rings stay consistent. */
export const PALETTE = {
	session: RING_COLOURS.coral,
	weekly: RING_COLOURS.teal,
	background: [0, 0, 0] as RGB
};
