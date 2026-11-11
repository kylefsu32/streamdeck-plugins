/**
 * Runs the real collectors for a few seconds and prints what each key would
 * see. Use it on the Mac to check readings against Activity Monitor without
 * going through the Stream Deck app.
 *
 * Run: npm run probe
 */

import { collectorFor } from "./collectors/index";
import type { AppUsage, Battery } from "./collectors/parse";
import { Hub } from "./sampler/hub";
import { bytes, compact, milliseconds, percent, rate } from "./render/format";

const hub = new Hub(collectorFor);
for (const key of ["cpu", "mem", "gpu", "diskio", "net", "proc", "battery", "space:/", "ping:1.1.1.1:1"]) {
	hub.want(key);
}
hub.start();

setTimeout(() => {
	hub.stop();
	const p = (s: string) => compact(percent(hub.latest(s)));
	const lines: [string, string][] = [
		["CPU total", p("cpu.total")],
		["CPU busiest core", p("cpu.peak")],
		["Load (1m)", hub.latest("cpu.load")?.toFixed(2) ?? "—"],
		["Memory used", `${compact(bytes(hub.latest("mem.used")))} (${p("mem.percent")})`],
		["Memory pressure", p("mem.pressure")],
		["Swap used", compact(bytes(hub.latest("swap.used")))],
		["GPU", `${p("gpu.device")} (renderer ${p("gpu.renderer")}, tiler ${p("gpu.tiler")})`],
		["GPU memory", compact(bytes(hub.latest("gpu.memory")))],
		["Disk read / write", `${compact(rate(hub.latest("disk.read")))} / ${compact(rate(hub.latest("disk.write")))}`],
		["Disk / used", `${p("space:/.used")} (${compact(bytes(hub.latest("space:/.free")))} free)`],
		["Network down / up", `${compact(rate(hub.latest("net.auto.rx")))} / ${compact(rate(hub.latest("net.auto.tx")))}`],
		["Interfaces", (hub.snapshot<string[]>("net.interfaces") ?? []).join(", ") || "—"],
		["Ping 1.1.1.1", compact(milliseconds(hub.latest("ping.1.1.1.1")))],
		["Battery", JSON.stringify(hub.snapshot<Battery | null>("battery") ?? null)]
	];
	const apps = [...(hub.snapshot<AppUsage[]>("proc") ?? [])].sort((a, b) => b.cpu - a.cpu).slice(0, 5);
	lines.push(["Top CPU", apps.map((a) => `${a.name} ${a.cpu.toFixed(0)}%`).join(", ") || "—"]);
	const width = Math.max(...lines.map(([k]) => k.length));
	for (const [k, v] of lines) console.log(`${k.padEnd(width)}  ${v}`);
	process.exit(0);
}, 4500);
