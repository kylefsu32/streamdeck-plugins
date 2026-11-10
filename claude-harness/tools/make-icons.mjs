/**
 * Rasterises the plugin's PNG assets from the same SVG the keys draw at
 * runtime, so the art in the action list matches the deck. Needs Playwright's
 * Chromium (`npx playwright install chromium` if it is not already there).
 *
 *   npm run icons
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { keyArt, actionIcons, pluginIcon, categoryIcon } = await import(path.resolve("dist/icons.mjs"));

const SD = "com.kylefsu.claude-harness.sdPlugin";
const browser = await chromium.launch();
const page = await browser.newPage();

async function png(svg, size, file) {
	mkdirSync(path.dirname(file), { recursive: true });
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<html><body style="margin:0;background:transparent"><img style="display:block" width="${size}" height="${size}" src="data:image/svg+xml,${encodeURIComponent(svg)}"></body></html>`
	);
	await page.waitForLoadState("load");
	await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

for (const [id, svg] of Object.entries(keyArt)) {
	await png(svg, 72, `${SD}/imgs/actions/${id}/key.png`);
	await png(svg, 144, `${SD}/imgs/actions/${id}/key@2x.png`);
}
for (const [id, svg] of Object.entries(actionIcons)) {
	await png(svg, 20, `${SD}/imgs/actions/${id}/icon.png`);
	await png(svg, 40, `${SD}/imgs/actions/${id}/icon@2x.png`);
}
await png(pluginIcon, 256, `${SD}/imgs/plugin/plugin.png`);
await png(pluginIcon, 512, `${SD}/imgs/plugin/plugin@2x.png`);
await png(categoryIcon, 28, `${SD}/imgs/plugin/category.png`);
await png(categoryIcon, 56, `${SD}/imgs/plugin/category@2x.png`);
await browser.close();
console.log("icons written");
