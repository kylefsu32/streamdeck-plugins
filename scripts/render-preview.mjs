// Renders sample key faces using the real gauge renderer into preview/.
// Run `npx tsc src/lib/gauge-svg.ts --outDir .preview --module es2022 --target es2022` first
// (npm run preview does both).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { renderKeySvg } = await import(join(root, ".preview", "gauge-svg.js"));

const states = [
	{
		name: "two-gauges",
		title: "2 gauges, reset timers on",
		svg: renderKeySvg(
			{
				gauges: [
					{ label: "5-HR", pct: 62, resetText: "2h 14m" },
					{ label: "WEEK", pct: 38, resetText: "4d 6h" }
				]
			},
			true
		)
	},
	{
		name: "two-gauges-hot",
		title: "2 gauges, near the caps",
		svg: renderKeySvg(
			{
				gauges: [
					{ label: "5-HR", pct: 93, resetText: "41m" },
					{ label: "OPUS", pct: 78, resetText: "2d 1h" }
				]
			},
			true
		)
	},
	{
		name: "two-gauges-plain",
		title: "2 gauges, reset timers off",
		svg: renderKeySvg(
			{
				gauges: [
					{ label: "5-HR", pct: 62, resetText: null },
					{ label: "WEEK", pct: 38, resetText: null }
				]
			},
			false
		)
	},
	{
		name: "one-gauge",
		title: "1 gauge (arc)",
		svg: renderKeySvg({ gauges: [{ label: "SESSION (5H)", pct: 62, resetText: "2h 14m" }] }, true)
	},
	{
		name: "one-gauge-hot",
		title: "1 gauge, near the cap",
		svg: renderKeySvg({ gauges: [{ label: "WEEK (ALL)", pct: 91, resetText: "3d 12h" }] }, true)
	},
	{
		name: "error-no-login",
		title: "Error: no credentials found",
		svg: renderKeySvg(
			{
				gauges: [
					{ label: "5-HR", pct: null, resetText: null },
					{ label: "WEEK", pct: null, resetText: null }
				],
				message: "No Claude login"
			},
			true
		)
	},
	{
		name: "error-expired",
		title: "Error: token expired (open Claude Code)",
		svg: renderKeySvg(
			{
				gauges: [
					{ label: "5-HR", pct: 47, resetText: null },
					{ label: "WEEK", pct: 22, resetText: null }
				],
				message: "Open Claude Code"
			},
			true
		)
	}
];

const outDir = join(root, "preview");
mkdirSync(outDir, { recursive: true });

const cards = [];
for (const s of states) {
	writeFileSync(join(outDir, `${s.name}.svg`), s.svg);
	cards.push(
		`<figure><div class="keys">` +
			`<span class="key k144">${s.svg}</span>` +
			`<span class="key k72">${s.svg}</span>` +
			`</div><figcaption>${s.title}</figcaption></figure>`
	);
	console.log("wrote", `preview/${s.name}.svg`);
}

const html = `<!DOCTYPE html>
<meta charset="utf-8">
<title>Claude Usage Gauges preview</title>
<style>
  body { background: #26262e; color: #ddd; font-family: -apple-system, 'Segoe UI', sans-serif; padding: 24px; }
  h1 { font-size: 18px; font-weight: 600; }
  p { color: #9a9aa6; font-size: 13px; }
  .grid { display: flex; flex-wrap: wrap; gap: 28px; margin-top: 20px; }
  figure { margin: 0; text-align: center; }
  .keys { display: flex; align-items: flex-end; gap: 12px; justify-content: center; }
  .key { display: inline-block; border-radius: 14px; overflow: hidden; line-height: 0; box-shadow: 0 4px 14px rgba(0,0,0,.45); }
  .key svg { display: block; }
  .k144 svg { width: 144px; height: 144px; }
  .k72 { border-radius: 8px; }
  .k72 svg { width: 72px; height: 72px; }
  figcaption { font-size: 12px; color: #9a9aa6; margin-top: 10px; }
</style>
<h1>Claude Usage Gauges: key previews</h1>
<p>Each state at 144px (Stream Deck XL / @2x) and 72px (physical key base size). Rounded corners approximate the hardware mask.</p>
<div class="grid">${cards.join("\n")}</div>
`;
writeFileSync(join(outDir, "preview.html"), html);
console.log("wrote preview/preview.html");
