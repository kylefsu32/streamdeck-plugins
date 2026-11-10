// Renders sample key faces using the real gauge renderer into preview/.
// Run via `npm run preview` (compiles src/lib/gauge-svg.ts to .preview/ first).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { renderKeySvg } = await import(join(root, ".preview", "gauge-svg.js"));

const g5 = { labelShort: "5-HR", labelLong: "SESSION (5H)", pct: 62, resetText: "2h 14m" };
const gWeek = { labelShort: "WEEK", labelLong: "WEEK (ALL)", pct: 38, resetText: "4d 6h" };
const g5hot = { labelShort: "5-HR", labelLong: "SESSION (5H)", pct: 93, resetText: "41m" };
const gOpus = { labelShort: "OPUS", labelLong: "WEEK (OPUS)", pct: 78, resetText: "2d 1h" };
const allText = { showPct: true, showLabel: true, showReset: true };
const threshold = { bg: "#16161d", mode: "threshold", colorA: "#43b581", colorB: "#e5484d" };
const gradientBlue = { bg: "#16161d", mode: "gradient", colorA: "#38bdf8", colorB: "#8957e5" };
const singleCoral = { bg: "#16161d", mode: "custom", colorA: "#d97757", colorB: "#e5484d" };
const lightBg = { bg: "#e8e8ee", mode: "threshold", colorA: "#43b581", colorB: "#e5484d" };

const states = [
	{ name: "bars-full", title: "Bars view, all text", svg: renderKeySvg({ gauges: [g5, gWeek] }, allText) },
	{ name: "bars-hot", title: "Bars view, near the caps", svg: renderKeySvg({ gauges: [g5hot, gOpus] }, allText) },
	{
		name: "bars-pct-only",
		title: "Bars, percentage only",
		svg: renderKeySvg({ gauges: [g5, gWeek] }, { showPct: true, showLabel: false, showReset: false })
	},
	{
		name: "bars-no-text",
		title: "Bars, no text (pure gauges)",
		svg: renderKeySvg({ gauges: [g5, gWeek] }, { showPct: false, showLabel: false, showReset: false })
	},
	{ name: "arc-full", title: "Arc view, threshold sweep", svg: renderKeySvg({ gauges: [g5] }, allText, threshold) },
	{
		name: "arc-gradient",
		title: "Arc, custom gradient",
		svg: renderKeySvg({ gauges: [g5] }, allText, gradientBlue)
	},
	{
		name: "arc-coral",
		title: "Arc, single custom color",
		svg: renderKeySvg({ gauges: [gOpus] }, allText, singleCoral)
	},
	{
		name: "bars-gradient",
		title: "Bars, custom gradient",
		svg: renderKeySvg({ gauges: [g5, gWeek] }, allText, gradientBlue)
	},
	{
		name: "bars-light",
		title: "Bars, light background",
		svg: renderKeySvg({ gauges: [g5, gWeek] }, allText, lightBg)
	},
	{
		name: "arc-label-center",
		title: "Arc, label instead of percentage",
		svg: renderKeySvg({ gauges: [gWeek] }, { showPct: false, showLabel: true, showReset: true })
	},
	{
		name: "arc-no-text",
		title: "Arc, no text",
		svg: renderKeySvg({ gauges: [g5hot] }, { showPct: false, showLabel: false, showReset: false })
	},
	{
		name: "error-expired",
		title: "Error: token expired",
		svg: renderKeySvg(
			{ gauges: [{ ...g5, pct: 47, resetText: null }, { ...gWeek, pct: 22, resetText: null }], message: "Press: open Claude" },
			allText
		)
	},
	{
		name: "error-no-login",
		title: "Error: no credentials found",
		svg: renderKeySvg(
			{
				gauges: [
					{ ...g5, pct: null, resetText: null },
					{ ...gWeek, pct: null, resetText: null }
				],
				message: "Press: sign in"
			},
			allText
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
