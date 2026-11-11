export type RGB = readonly [number, number, number];

export type Theme = {
	background: RGB;
	text: RGB;
	muted: RGB;
	grid: RGB;
};

export const THEMES: Record<string, Theme> = {
	graphite: { background: [22, 24, 28], text: [242, 244, 247], muted: [140, 146, 158], grid: [44, 48, 56] },
	black: { background: [0, 0, 0], text: [255, 255, 255], muted: [128, 128, 128], grid: [34, 34, 34] },
	midnight: { background: [10, 16, 36], text: [232, 238, 255], muted: [122, 138, 184], grid: [28, 38, 70] },
	paper: { background: [244, 244, 240], text: [24, 26, 30], muted: [110, 114, 122], grid: [218, 218, 212] }
};

export const ACCENTS: Record<string, RGB> = {
	blue: [76, 154, 255],
	teal: [45, 212, 191],
	green: [74, 222, 128],
	lime: [190, 242, 100],
	amber: [251, 191, 36],
	orange: [251, 146, 60],
	red: [248, 113, 113],
	pink: [244, 114, 182],
	violet: [167, 139, 250],
	white: [229, 231, 235]
};

export const ALERT: RGB = [255, 84, 84];

export function theme(name: string | undefined): Theme {
	return THEMES[name ?? ""] ?? THEMES["graphite"]!;
}

export function accent(name: string | undefined, fallback: string): RGB {
	return ACCENTS[name ?? ""] ?? ACCENTS[fallback] ?? ACCENTS["blue"]!;
}

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
