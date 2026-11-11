/**
 * Renders every key face from synthetic data, with no Stream Deck and no Mac
 * required. Writes dist/preview.html to eyeball, and dist/faces.json, which
 * tools/make-icons.mjs rasterises into the default key images.
 *
 * Run: npm run preview
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { ledger } from "./collectors/index";
import type { AppUsage } from "./collectors/parse";
import { face, type Category, type Settings } from "./metrics";
import { Hub } from "./sampler/hub";

const hub = new Hub(() => undefined);
const now = Date.now();

function wave(n: number, base: number, amp: number, period: number, noise: number, seed = 1): number[] {
	let s = seed;
	const rand = (): number => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
	return Array.from({ length: n }, (_, i) => Math.max(0, base + amp * Math.sin((i / period) * Math.PI * 2) + (rand() - 0.5) * noise));
}

function fill(series: string, values: number[]): void {
	for (const v of values) hub.record(series, v);
}

const GB = 1024 ** 3;
fill("cpu.total", wave(120, 28, 14, 40, 18, 2));
fill("cpu.peak", wave(120, 62, 20, 30, 25, 3));
fill("cpu.load", wave(120, 3.2, 1.1, 50, 0.6, 4));
hub.setSnapshot("cpu.count", 10);
wave(10, 40, 35, 6, 30, 5).forEach((v, i) => hub.record(`cpu.core.${i}`, Math.min(100, v)));
hub.setSnapshot("mem.total", 32 * GB);
fill("mem.used", wave(120, 19.6 * GB, 0.6 * GB, 80, 0.3 * GB, 6));
fill("mem.percent", wave(120, 61, 2, 80, 1, 6));
fill("mem.pressure", wave(120, 34, 6, 60, 4, 7));
fill("swap.used", wave(120, 1.4 * GB, 0.1 * GB, 90, 0.02 * GB, 8));
fill("swap.percent", wave(120, 70, 3, 90, 1, 8));
fill("gpu.device", wave(120, 45, 30, 25, 20, 9));
fill("gpu.renderer", wave(120, 40, 28, 25, 20, 10));
fill("gpu.tiler", wave(120, 22, 15, 25, 10, 11));
fill("gpu.memory", wave(120, 3.1 * GB, 0.4 * GB, 40, 0.1 * GB, 12));
fill("disk.read", wave(120, 40e6, 60e6, 20, 30e6, 13));
fill("disk.write", wave(120, 15e6, 25e6, 33, 20e6, 14));
fill("disk.total", wave(120, 55e6, 70e6, 20, 30e6, 13));
hub.setSnapshot("space:/.total", 994.66e9);
fill("space:/.used", [71.2]);
fill("space:/.free", [286.4e9]);
fill("net.auto.rx", wave(120, 6.2e6, 5e6, 18, 4e6, 15));
fill("net.auto.tx", wave(120, 0.9e6, 0.7e6, 22, 0.5e6, 16));
for (let i = 0; i < 1440; i += 7) ledger.add("auto", 180e6 * Math.random(), 30e6 * Math.random(), now - i * 60_000);
const pings = wave(120, 18, 6, 30, 8, 17);
pings[96] = NaN;
pings[97] = NaN;
fill("ping.1.1.1.1", pings);
hub.setSnapshot("battery", { percent: 82, state: "discharging", remaining: "6:41" });
fill("battery.percent", wave(120, 83, 0.5, 120, 0.2, 18));
const apps: AppUsage[] = [
	{ name: "Google Chrome", cpu: 48.2, rss: 4.1 * GB, count: 31 },
	{ name: "Xcode", cpu: 21.7, rss: 3.2 * GB, count: 4 },
	{ name: "WindowServer", cpu: 14.9, rss: 0.9 * GB, count: 1 },
	{ name: "Claude", cpu: 6.1, rss: 1.4 * GB, count: 6 },
	{ name: "Spotify", cpu: 3.3, rss: 0.5 * GB, count: 5 }
];
hub.setSnapshot("proc", apps);
fill("app.Xcode.up", [1]);
fill("app.Xcode.cpu", wave(120, 22, 18, 30, 12, 19));
hub.setSnapshot("app.Xcode.name", "Xcode");
fill("app.Safari.up", [0]);
fill("app.Safari.cpu", [...wave(80, 12, 8, 20, 6, 20), ...Array(40).fill(0)]);

type Case = { name: string; category: Category; settings: Settings; key?: string };
const cases: Case[] = [
	{ name: "CPU graph", category: "cpu", settings: {}, key: "cpu" },
	{ name: "CPU gauge", category: "cpu", settings: { style: "gauge" } },
	{ name: "CPU cores", category: "cpu", settings: { metric: "cores" } },
	{ name: "Load", category: "cpu", settings: { metric: "load", style: "number" } },
	{ name: "Memory", category: "memory", settings: {}, key: "memory" },
	{ name: "Memory GB gauge", category: "memory", settings: { metric: "used", style: "gauge" } },
	{ name: "Pressure", category: "memory", settings: { metric: "pressure" } },
	{ name: "GPU", category: "gpu", settings: {}, key: "gpu" },
	{ name: "GPU gauge midnight", category: "gpu", settings: { style: "gauge", theme: "midnight" } },
	{ name: "Disk used", category: "disk", settings: { style: "gauge" }, key: "disk" },
	{ name: "Disk activity", category: "disk", settings: { metric: "activity" } },
	{ name: "Disk free", category: "disk", settings: { metric: "free", style: "number" } },
	{ name: "Network", category: "network", settings: {}, key: "network" },
	{ name: "Network bits", category: "network", settings: { metric: "down", bits: true, theme: "black" } },
	{ name: "Last 24h", category: "network", settings: { metric: "day" } },
	{ name: "Ping", category: "ping", settings: {}, key: "ping" },
	{ name: "Ping alert", category: "ping", settings: { alertAbove: 15, theme: "paper" } },
	{ name: "Uptime", category: "system", settings: {}, key: "system" },
	{ name: "Battery", category: "system", settings: { metric: "battery", style: "gauge" } },
	{ name: "Top CPU", category: "top", settings: {}, key: "top" },
	{ name: "Top memory x5", category: "top", settings: { metric: "memory", count: 5 } },
	{ name: "App watch", category: "app", settings: { app: "Xcode" }, key: "app" },
	{ name: "App closed", category: "app", settings: { app: "Safari" } },
	{ name: "CPU alert paper", category: "cpu", settings: { metric: "peak", alertAbove: 50, theme: "paper" } }
];

const faces: Record<string, string> = {};
const tiles = cases.map((c) => {
	const uri = face(hub, c.category, c.settings, now);
	if (c.key) faces[c.key] = uri;
	return `<figure><img src="${uri}" width="144" height="144"><figcaption>${c.name}</figcaption></figure>`;
});

mkdirSync("dist", { recursive: true });
writeFileSync(
	"dist/preview.html",
	`<!doctype html><meta charset="utf-8"><title>System Vitals preview</title>
<style>body{background:#0d0d0f;color:#aaa;font:12px -apple-system,sans-serif;display:flex;flex-wrap:wrap;gap:14px;padding:16px;margin:0}
figure{margin:0;text-align:center}img{border-radius:16px;display:block}figcaption{margin-top:6px}</style>
${tiles.join("\n")}`
);
writeFileSync("dist/faces.json", JSON.stringify(faces));
console.log(`wrote dist/preview.html (${cases.length} faces) and dist/faces.json`);
hub.stop();
