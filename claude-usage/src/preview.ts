/**
 * Renders the key art to `dist/preview.html`, so the design can be checked
 * without a Stream Deck attached.
 *
 * Usage: npm run preview
 */

import { mkdir, writeFile } from "node:fs/promises";

import { compactDuration, compactTokens, percentLabel } from "./render/format";
import { colour, GEOMETRY, PALETTE, renderRings, RING_COLOURS, type ColourName } from "./render/rings";

type Level = { caption: string; session: number; weekly: number };

const LEVELS: Level[] = [
	{ caption: "idle", session: 0, weekly: 0.04 },
	{ caption: "early", session: 0.18, weekly: 0.11 },
	{ caption: "steady", session: 0.46, weekly: 0.33 },
	{ caption: "warm", session: 0.72, weekly: 0.51 },
	{ caption: "close", session: 0.94, weekly: 0.68 },
	{ caption: "at limit", session: 1.0, weekly: 0.74 },
	{ caption: "over", session: 1.28, weekly: 0.86 },
	{ caption: "well over", session: 1.75, weekly: 1.12 }
];

function dual(level: Level, text: boolean): string {
	return renderRings({
		background: PALETTE.background,
		rings: [
			{ value: level.session, ...GEOMETRY.outer, ...RING_COLOURS.coral },
			{ value: level.weekly, ...GEOMETRY.inner, ...RING_COLOURS.teal }
		],
		...(text ? { centreText: percentLabel(level.session), centreSubText: "5H" } : {})
	});
}

function single(value: number, name: ColourName, text: string | undefined, sub: string): string {
	return renderRings({
		background: PALETTE.background,
		rings: [{ value, ...GEOMETRY.solo, ...colour(name, "coral") }],
		...(text ? { centreText: text, centreSubText: sub } : {})
	});
}

function keys(items: { src: string; caption: string }[]): string {
	return items
		.map(
			(item) =>
				`<figure><img src="${item.src}" width="96" height="96" alt="${item.caption}"/>` +
				`<figcaption>${item.caption}</figcaption></figure>`
		)
		.join("");
}

function section(title: string, note: string, inner: string): string {
	return `<section><h2>${title}</h2><p>${note}</p><div class="keys">${inner}</div></section>`;
}

async function main(): Promise<void> {
	const resting = keys(LEVELS.map((l) => ({ src: dual(l, false), caption: l.caption })));
	const pressed = keys(LEVELS.map((l) => ({ src: dual(l, true), caption: l.caption })));

	const singles = keys([
		{ src: single(0.46, "coral", undefined, ""), caption: "5h" },
		{ src: single(0.33, "teal", undefined, ""), caption: "week" },
		{ src: single(0.61, "violet", undefined, ""), caption: "fable" },
		{ src: single(0.22, "amber", undefined, ""), caption: "opus" },
		{ src: single(0.78, "green", undefined, ""), caption: "haiku" },
		{ src: single(1.14, "blue", undefined, ""), caption: "over" }
	]);

	const singlesPressed = keys([
		{ src: single(0.46, "coral", percentLabel(0.46), "5H"), caption: "5h" },
		{ src: single(0.33, "teal", percentLabel(0.33), "7D"), caption: "week" },
		{ src: single(0.61, "violet", percentLabel(0.61), "FABLE"), caption: "fable" },
		{ src: single(0.22, "amber", compactTokens(9_240_000), "OPUS"), caption: "opus, no ceiling" },
		{ src: single(0.78, "green", compactTokens(1_180_000), "HAIKU"), caption: "haiku, no ceiling" },
		{ src: single(0.55, "coral", compactDuration(2 * 3_600_000 + 42 * 60_000), "LEFT"), caption: "burn rate" }
	]);

	const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Claude Usage — key preview</title>
<style>
  :root { color-scheme: dark; }
  body { background:#141414; color:#e8e8e8; font:14px/1.5 -apple-system,Helvetica,Arial,sans-serif; margin:0; padding:32px; }
  h1 { font-size:20px; font-weight:600; margin:0 0 4px; }
  .lede { color:#9a9a9a; margin:0 0 28px; max-width:64ch; }
  section { margin-bottom:34px; }
  h2 { font-size:14px; font-weight:600; margin:0 0 2px; }
  section p { color:#9a9a9a; margin:0 0 14px; font-size:13px; max-width:64ch; }
  .keys { display:flex; flex-wrap:wrap; gap:14px; }
  figure { margin:0; text-align:center; }
  img { display:block; border-radius:11px; background:#000; }
  figcaption { color:#7d7d7d; font-size:11px; margin-top:6px; }
</style></head>
<body>
<h1>Claude Usage — key preview</h1>
<p class="lede">Rendered at 96&nbsp;px, the size a Stream Deck XL key draws at. Keys rest as rings
alone; pressing one reveals its readout. Past 100% the ring turns red and a thinner overshoot
arc wraps back around on top.</p>
${section("Two rings — resting", "The default. Outer ring is the session window, inner ring the week.", resting)}
${section("Two rings — pressed", "Press to reveal the readout, press again to hide it.", pressed)}
${section("One ring — resting", "A single ring per key: one for the session, one for the week, one filtered to a model.", singles)}
${section("One ring — pressed", "Without a ceiling the readout falls back to raw effective tokens.", singlesPressed)}
</body></html>`;

	await mkdir("dist", { recursive: true });
	await writeFile("dist/preview.html", html, "utf8");
	console.log("wrote dist/preview.html");
}

void main();
