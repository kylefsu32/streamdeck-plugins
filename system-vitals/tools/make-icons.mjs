#!/usr/bin/env node
/**
 * Rasterises the plugin's PNG assets with the Chromium that Playwright drives.
 *
 *  - Action list icons: white line glyphs on transparent, 20px and 40px.
 *  - Default key images: real key faces from `npm run preview` (dist/faces.json),
 *    so a freshly dropped key already looks like itself before the first sample.
 *  - Plugin and category icons.
 *
 * Needs Playwright with a Chromium (`npx playwright install chromium` once).
 * Run: npm run preview && npm run icons
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import url from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const imgs = path.join(root, "com.kylefsu.system-vitals.sdPlugin", "imgs");

const S = `fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;

/** 48×48 line glyphs. */
const GLYPHS = {
	cpu: `<rect x="12" y="12" width="24" height="24" rx="4" ${S}/><rect x="19" y="19" width="10" height="10" rx="1.5" fill="#fff"/>
		<path d="M18 12V6M24 12V6M30 12V6M18 42v-6M24 42v-6M30 42v-6M12 18H6M12 24H6M12 30H6M42 18h-6M42 24h-6M42 30h-6" ${S}/>`,
	memory: `<rect x="5" y="14" width="38" height="18" rx="2.5" ${S}/><path d="M12 20v6M19 20v6M26 20v6M33 20v6M8 32v4M14 32v4M34 32v4M40 32v4" ${S}/>`,
	gpu: `<rect x="5" y="12" width="38" height="24" rx="3.5" ${S}/><circle cx="18" cy="24" r="7" ${S}/><circle cx="18" cy="24" r="1.8" fill="#fff"/>
		<path d="M31 19h7M31 24h7M31 29h7M10 36v5M16 36v5" ${S}/>`,
	disk: `<ellipse cx="24" cy="12" rx="15" ry="5.5" ${S}/><path d="M9 12v24c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5V12M9 24c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5" ${S}/>`,
	network: `<path d="M16 8v30M16 38l-7-7M16 38l7-7M32 40V10M32 10l-7 7M32 10l7 7" ${S}/>`,
	ping: `<circle cx="13" cy="35" r="3.5" fill="#fff"/><path d="M13 24a11 11 0 0 1 11 11M13 15a20 20 0 0 1 20 20M13 6a29 29 0 0 1 29 29" ${S}/>`,
	system: `<circle cx="24" cy="25" r="16" ${S}/><path d="M24 15v10l7 5M19 5h10" ${S}/>`,
	top: `<path d="M8 12h32M8 21h24M8 30h16M8 39h9" ${S}/>`,
	app: `<rect x="6" y="8" width="36" height="32" rx="5" ${S}/><path d="M6 16h36M12 33l7-7 5 4 10-10" ${S}/>`
};

const PULSE = (colour, width) =>
	`<path d="M6 26h9l4-9 6 18 5-13 3 4h9" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

const glyph = (body, size) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">${body}</svg>`;

const pluginIcon = (size) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
	<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#23262d"/><stop offset="1" stop-color="#121418"/></linearGradient>
	<linearGradient id="ln" x1="6" y1="0" x2="42" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4c9aff"/><stop offset="0.5" stop-color="#2dd4bf"/><stop offset="1" stop-color="#4ade80"/></linearGradient></defs>
	<rect width="48" height="48" rx="10" fill="url(#bg)"/>
	<path d="M6 34h36" stroke="#2c3038" stroke-width="1"/>
	${PULSE("url(#ln)", 3.2)}
	</svg>`;

async function main() {
	const browser = await chromium.launch();
	const page = await browser.newPage({ deviceScaleFactor: 1 });

	async function shoot(svg, size, out) {
		mkdirSync(path.dirname(out), { recursive: true });
		await page.setViewportSize({ width: size, height: size });
		await page.setContent(
			`<html><body style="margin:0;background:transparent"><img id="i" width="${size}" height="${size}" src="data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}"></body></html>`
		);
		await page.waitForFunction(() => document.getElementById("i").complete);
		await page.locator("#i").screenshot({ path: out, omitBackground: true });
	}

	async function shootUri(uri, size, out) {
		await page.setViewportSize({ width: size, height: size });
		await page.setContent(`<html><body style="margin:0"><img id="i" width="${size}" height="${size}" src="${uri}"></body></html>`);
		await page.waitForFunction(() => document.getElementById("i").complete);
		await page.locator("#i").screenshot({ path: out });
	}

	const faces = JSON.parse(readFileSync(path.join(root, "dist", "faces.json"), "utf8"));

	for (const [name, body] of Object.entries(GLYPHS)) {
		const dir = path.join(imgs, "actions", name);
		await shoot(glyph(body, 20), 20, path.join(dir, "icon.png"));
		await shoot(glyph(body, 40), 40, path.join(dir, "icon@2x.png"));
		if (!faces[name]) throw new Error(`no preview face for ${name}`);
		await shootUri(faces[name], 72, path.join(dir, "key.png"));
		await shootUri(faces[name], 144, path.join(dir, "key@2x.png"));
	}

	await shoot(pluginIcon(256), 256, path.join(imgs, "plugin", "plugin.png"));
	await shoot(pluginIcon(512), 512, path.join(imgs, "plugin", "plugin@2x.png"));
	await shoot(glyph(PULSE("#fff", 3.5), 28), 28, path.join(imgs, "plugin", "category.png"));
	await shoot(glyph(PULSE("#fff", 3.5), 56), 56, path.join(imgs, "plugin", "category@2x.png"));

	await browser.close();
	console.log("icons written to", imgs);
}

await main();
