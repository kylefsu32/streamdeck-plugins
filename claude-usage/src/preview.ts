/**
 * Renders the key art to `dist/preview.html`, so the design can be checked
 * without a Stream Deck attached.
 *
 * Usage: npm run preview
 */

import { mkdir, writeFile } from "node:fs/promises";

import { compactDuration, compactTokens, percentLabel } from "./render/format";
import { renderReadout } from "./render/readout";
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

function pick(name: ColourName, value: number) {
	const palette = RING_COLOURS[name];
	return value > 1 ? palette.over : palette.lit;
}

function dualRings(level: Level): string {
	return renderRings({
		background: PALETTE.background,
		rings: [
			{ value: level.session, ...GEOMETRY.outer, ...RING_COLOURS.coral },
			{ value: level.weekly, ...GEOMETRY.inner, ...RING_COLOURS.teal }
		]
	});
}

function dualText(level: Level): string {
	return renderReadout({
		background: PALETTE.background,
		rows: [
			{ value: percentLabel(level.session), label: "5H", colour: pick("coral", level.session) },
			{ value: percentLabel(level.weekly), label: "7D", colour: pick("teal", level.weekly) }
		]
	});
}

function singleRing(value: number, name: ColourName): string {
	return renderRings({
		background: PALETTE.background,
		rings: [{ value, ...GEOMETRY.solo, ...colour(name, "coral") }]
	});
}

function singleText(value: string, label: string, name: ColourName, over = 0): string {
	return renderReadout({
		background: PALETTE.background,
		rows: [{ value, label, colour: pick(name, over) }]
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
	const resting = keys(LEVELS.map((l) => ({ src: dualRings(l), caption: l.caption })));
	const pressed = keys(LEVELS.map((l) => ({ src: dualText(l), caption: l.caption })));

	const singles = keys([
		{ src: singleRing(0.46, "coral"), caption: "5h" },
		{ src: singleRing(0.33, "teal"), caption: "week" },
		{ src: singleRing(0.61, "violet"), caption: "fable" },
		{ src: singleRing(0.22, "amber"), caption: "opus" },
		{ src: singleRing(0.78, "green"), caption: "haiku" },
		{ src: singleRing(1.14, "blue"), caption: "over" }
	]);

	const singlesPressed = keys([
		{ src: singleText(percentLabel(0.46), "5H", "coral", 0.46), caption: "5h" },
		{ src: singleText(percentLabel(0.33), "7D", "teal", 0.33), caption: "week" },
		{ src: singleText(percentLabel(0.61), "FABLE", "violet", 0.61), caption: "fable" },
		{ src: singleText(compactTokens(9_240_000), "OPUS", "amber"), caption: "opus, no ceiling" },
		{ src: singleText(percentLabel(1.14), "HAIKU", "green", 1.14), caption: "over budget" },
		{ src: singleText(compactDuration(2 * 3_600_000 + 42 * 60_000), "LEFT", "coral"), caption: "burn rate" }
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
<p class="lede">Rendered at 96&nbsp;px, the size a Stream Deck XL key draws at. A key rests as rings
alone; pressing swaps the face to text alone. Values keep their ring's colour and turn red over
budget, so a pressed key is still identifiable.</p>
${section("Two rings — resting", "The default. Outer ring is the session window, inner ring the week.", resting)}
${section("Two rings — pressed", "Both figures, no rings. The numbers get the whole canvas.", pressed)}
${section("One ring — resting", "A single ring per key: one for the session, one for the week, one filtered to a model.", singles)}
${section("One ring — pressed", "Without a ceiling the readout falls back to raw effective tokens.", singlesPressed)}
</body></html>`;

	await mkdir("dist", { recursive: true });
	await writeFile("dist/preview.html", html, "utf8");
	console.log("wrote dist/preview.html");
}

void main();
