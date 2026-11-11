/**
 * What each key shows: turns an action's category and settings into the
 * sources it needs from the hub and a rendered face.
 */

import os from "node:os";

import type { AppUsage, Battery } from "./collectors/parse";
import { ledger } from "./collectors/index";
import type { Hub } from "./sampler/hub";
import { renderCores, renderGauge, renderGraph, renderList, renderMessage, renderNumber, type Line, type Readout } from "./render/faces";
import { bytes, compact, duration, milliseconds, percent, rate, volume, type Formatted } from "./render/format";
import { accent, ALERT, theme, type RGB, type Theme } from "./render/theme";

export type Category = "cpu" | "memory" | "gpu" | "disk" | "network" | "ping" | "system" | "top" | "app";
export type Style = "graph" | "gauge" | "number";

export type Settings = {
	metric?: string;
	style?: Style;
	theme?: string;
	colour?: string;
	/** Value turns red above this (in the metric's own unit: %, ms, MB/s…). */
	alertAbove?: number | string;
	press?: "monitor" | "cycle" | "none";
	volume?: string;
	iface?: string;
	bits?: boolean;
	host?: string;
	pingSeconds?: number | string;
	app?: string;
	sortBy?: "cpu" | "memory";
	count?: number | string;
	/** How many seconds of history the graph spans. */
	graphSeconds?: number | string;
};

/** Metrics offered per category, in the order a press cycles through them. */
export const METRICS: Record<Category, string[]> = {
	cpu: ["total", "peak", "cores", "load"],
	memory: ["percent", "used", "pressure", "swap"],
	gpu: ["device", "renderer", "tiler", "memory"],
	disk: ["used", "free", "activity", "read", "write"],
	network: ["both", "down", "up", "minute", "hour", "day"],
	ping: ["latency"],
	system: ["uptime", "battery"],
	top: ["cpu", "memory"],
	app: ["cpu", "memory"]
};

const DEFAULT_ACCENT: Record<Category, string> = {
	cpu: "blue",
	memory: "violet",
	gpu: "green",
	disk: "amber",
	network: "teal",
	ping: "lime",
	system: "white",
	top: "orange",
	app: "orange"
};

export function metricOf(category: Category, settings: Settings): string {
	const list = METRICS[category];
	return settings.metric && list.includes(settings.metric) ? settings.metric : list[0]!;
}

export function nextMetric(category: Category, settings: Settings): string {
	const list = METRICS[category];
	const i = list.indexOf(metricOf(category, settings));
	return list[(i + 1) % list.length]!;
}

export function toNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string" && value.trim().length > 0) {
		const n = Number(value);
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/** Everything a face needs for a single-number metric. */
type Spec = {
	label: string;
	readout: Formatted;
	sub?: string;
	subColour?: RGB;
	lines: { series: string; colour?: RGB }[];
	/** Graph ceiling. Undefined means scale to the visible history. */
	max?: number;
	/** Smallest auto-scale ceiling, so idle noise doesn't fill the tile. */
	floor?: number;
	/** 0..1 for the gauge. */
	fraction?: number;
	/** Raw value compared against `alertAbove`, in the unit shown. */
	alertValue?: number;
};

type Ctx = { hub: Hub; settings: Settings; now: number; colour: RGB; theme: Theme };

function cpu(ctx: Ctx, metric: string): Spec | "cores" {
	const { hub } = ctx;
	hub.want("cpu");
	switch (metric) {
		case "cores":
			return "cores";
		case "peak": {
			const v = hub.latest("cpu.peak");
			return { label: "CPU peak", readout: percent(v), lines: [{ series: "cpu.peak" }], max: 100, fraction: (v ?? 0) / 100, alertValue: v };
		}
		case "load": {
			const v = hub.latest("cpu.load");
			const cores = hub.snapshot<number>("cpu.count") ?? os.cpus().length;
			return {
				label: "Load",
				readout: { value: v === undefined ? "—" : v.toFixed(2), unit: "" },
				sub: `${cores} cores`,
				lines: [{ series: "cpu.load" }],
				max: cores,
				fraction: (v ?? 0) / cores,
				alertValue: v
			};
		}
		default: {
			const v = hub.latest("cpu.total");
			return { label: "CPU", readout: percent(v), lines: [{ series: "cpu.total" }], max: 100, fraction: (v ?? 0) / 100, alertValue: v };
		}
	}
}

function memory(ctx: Ctx, metric: string): Spec {
	const { hub } = ctx;
	hub.want("mem");
	const total = hub.snapshot<number>("mem.total") ?? os.totalmem();
	switch (metric) {
		case "used": {
			const v = hub.latest("mem.used");
			return {
				label: "Memory",
				readout: bytes(v),
				sub: `of ${compact(bytes(total))}`,
				lines: [{ series: "mem.used" }],
				max: total,
				fraction: (v ?? 0) / total,
				alertValue: v === undefined ? undefined : v / 1024 ** 3
			};
		}
		case "pressure": {
			const v = hub.latest("mem.pressure");
			const colour = v === undefined ? undefined : v >= 75 ? ALERT : v >= 50 ? ([251, 191, 36] as RGB) : undefined;
			return {
				label: "Pressure",
				readout: percent(v),
				lines: [{ series: "mem.pressure", colour }],
				max: 100,
				fraction: (v ?? 0) / 100,
				alertValue: v
			};
		}
		case "swap": {
			const v = hub.latest("swap.used");
			return {
				label: "Swap",
				readout: bytes(v),
				lines: [{ series: "swap.used" }],
				floor: 1024 ** 3,
				fraction: (hub.latest("swap.percent") ?? 0) / 100,
				alertValue: v === undefined ? undefined : v / 1024 ** 3
			};
		}
		default: {
			const v = hub.latest("mem.percent");
			return {
				label: "Memory",
				readout: percent(v),
				sub: `${compact(bytes(hub.latest("mem.used")))} / ${compact(bytes(total))}`,
				lines: [{ series: "mem.percent" }],
				max: 100,
				fraction: (v ?? 0) / 100,
				alertValue: v
			};
		}
	}
}

function gpu(ctx: Ctx, metric: string): Spec {
	const { hub } = ctx;
	hub.want("gpu");
	if (metric === "memory") {
		const v = hub.latest("gpu.memory");
		const total = os.totalmem();
		return {
			label: "GPU mem",
			readout: bytes(v),
			lines: [{ series: "gpu.memory" }],
			floor: 1024 ** 3,
			fraction: (v ?? 0) / total,
			alertValue: v === undefined ? undefined : v / 1024 ** 3
		};
	}
	const series = metric === "renderer" ? "gpu.renderer" : metric === "tiler" ? "gpu.tiler" : "gpu.device";
	const label = metric === "renderer" ? "GPU render" : metric === "tiler" ? "GPU tiler" : "GPU";
	const v = hub.latest(series);
	return { label, readout: percent(v), lines: [{ series }], max: 100, fraction: (v ?? 0) / 100, alertValue: v };
}

function disk(ctx: Ctx, metric: string): Spec {
	const { hub, settings } = ctx;
	if (metric === "read" || metric === "write" || metric === "activity") {
		hub.want("diskio");
		const series = metric === "read" ? "disk.read" : metric === "write" ? "disk.write" : "disk.total";
		const v = hub.latest(series);
		const lines =
			metric === "activity"
				? [{ series: "disk.read" }, { series: "disk.write", colour: [244, 114, 182] as RGB }]
				: [{ series }];
		return {
			label: metric === "read" ? "Disk read" : metric === "write" ? "Disk write" : "Disk",
			readout: rate(v),
			sub:
				metric === "activity"
					? `R ${short(rate(hub.latest("disk.read")))}  W ${short(rate(hub.latest("disk.write")))}`
					: undefined,
			lines,
			floor: 1e6,
			fraction: Math.min(1, (v ?? 0) / 2e9),
			alertValue: v === undefined ? undefined : v / 1e6
		};
	}
	const vol = settings.volume?.trim() || "/";
	hub.want(`space:${vol}`);
	const total = hub.snapshot<number>(`space:${vol}.total`);
	const usedPct = hub.latest(`space:${vol}.used`);
	const name = vol === "/" ? "Disk" : vol.split("/").filter(Boolean).pop() ?? vol;
	if (metric === "free") {
		const free = hub.latest(`space:${vol}.free`);
		return {
			label: `${name} free`,
			readout: volume(free),
			sub: total ? `of ${compact(volume(total))}` : undefined,
			lines: [{ series: `space:${vol}.free` }],
			max: total,
			fraction: total && free !== undefined ? free / total : 0,
			alertValue: free === undefined ? undefined : free / 1e9
		};
	}
	return {
		label: name,
		readout: percent(usedPct),
		sub: total ? `${compact(volume(hub.latest(`space:${vol}.free`)))} free` : undefined,
		lines: [{ series: `space:${vol}.used` }],
		max: 100,
		fraction: (usedPct ?? 0) / 100,
		alertValue: usedPct
	};
}

/** "8.61 MB/s" → "8.6M", for two rates side by side on one line. */
function short(f: Formatted): string {
	const n = Number(f.value);
	const v = Number.isFinite(n) ? (n >= 10 ? Math.round(n).toString() : n.toFixed(1)) : f.value;
	const prefix = f.unit.charAt(0);
	return /[KMGT]/.test(prefix) ? `${v}${prefix}` : v;
}

const UP_COLOUR: RGB = [244, 114, 182];

function network(ctx: Ctx, metric: string): Spec {
	const { hub, settings, now } = ctx;
	hub.want("net");
	const iface = settings.iface?.trim() || "auto";
	const bits = settings.bits === true;
	const rx = hub.latest(`net.${iface}.rx`);
	const tx = hub.latest(`net.${iface}.tx`);
	const where = iface === "auto" ? "" : ` ${iface}`;
	const floor = 125_000; // 1 Mb/s, so an idle link doesn't graph its own noise
	switch (metric) {
		case "down":
			return { label: `Down${where}`, readout: rate(rx, bits), lines: [{ series: `net.${iface}.rx` }], floor, fraction: 0, alertValue: rx === undefined ? undefined : rx / 1e6 };
		case "up":
			return { label: `Up${where}`, readout: rate(tx, bits), lines: [{ series: `net.${iface}.tx`, colour: UP_COLOUR }], floor, fraction: 0, alertValue: tx === undefined ? undefined : tx / 1e6 };
		case "minute":
		case "hour":
		case "day": {
			const windowMs = metric === "minute" ? 60_000 : metric === "hour" ? 3_600_000 : 86_400_000;
			const t = ledger.total(iface, windowMs, now);
			return {
				label: `${metric === "minute" ? "Last 60s" : metric === "hour" ? "Last hour" : "Last 24h"}${where}`,
				readout: volume(t.rx + t.tx),
				sub: `↓${compact(volume(t.rx))} ↑${compact(volume(t.tx))}`,
				lines: [{ series: `net.${iface}.rx` }, { series: `net.${iface}.tx`, colour: UP_COLOUR }],
				floor,
				fraction: 0
			};
		}
		default:
			return {
				label: `Net${where}`,
				readout: rate(rx, bits),
				sub: `↑ ${compact(rate(tx, bits))}`,
				subColour: UP_COLOUR,
				lines: [{ series: `net.${iface}.rx` }, { series: `net.${iface}.tx`, colour: UP_COLOUR }],
				floor,
				fraction: 0,
				alertValue: rx === undefined ? undefined : rx / 1e6
			};
	}
}

function ping(ctx: Ctx): Spec {
	const { hub, settings } = ctx;
	const host = settings.host?.trim() || "1.1.1.1";
	const seconds = Math.max(1, Math.min(60, toNumber(settings.pingSeconds) ?? 2));
	hub.want(`ping:${host}:${seconds}`);
	const history = hub.history(`ping.${host}`, 30);
	const v = hub.latest(`ping.${host}`);
	const lost = history.filter((x) => !Number.isFinite(x)).length;
	const lostNow = history.length > 0 && v !== undefined && !Number.isFinite(v);
	return {
		label: host.length > 12 ? "Ping" : host,
		readout: lostNow ? { value: "LOST", unit: "" } : milliseconds(v),
		sub: history.length >= 5 ? (lost > 0 ? `${Math.round((lost / history.length) * 100)}% loss` : "no loss") : undefined,
		subColour: lost > 0 ? ALERT : undefined,
		lines: [{ series: `ping.${host}` }],
		floor: 40,
		fraction: Math.min(1, (Number.isFinite(v) ? v ?? 0 : 0) / 200),
		alertValue: lostNow ? Infinity : v
	};
}

function system(ctx: Ctx, metric: string): Spec | { message: string; label: string } {
	const { hub } = ctx;
	if (metric === "battery") {
		hub.want("battery");
		const batt = hub.snapshot<Battery | null>("battery");
		if (batt === null) return { label: "Battery", message: "No battery" };
		const v = batt?.percent;
		const state = batt?.state ?? "";
		const sub =
			state === "charging"
				? batt?.remaining ? `charging · ${batt.remaining}` : "charging"
				: state === "discharging" && batt?.remaining
					? `${batt.remaining} left`
					: state === "charged" || state === "AC attached" || state === "finishing charge"
						? "on power"
						: state || undefined;
		return {
			label: "Battery",
			readout: percent(v),
			sub,
			lines: [{ series: "battery.percent" }],
			max: 100,
			fraction: (v ?? 0) / 100,
			// Low battery is the alarming direction, so invert for the alert check.
			alertValue: v === undefined ? undefined : 100 - v
		};
	}
	const up = duration(os.uptime());
	return { label: "Uptime", readout: up, lines: [], fraction: 0 };
}

function colourFor(spec: Spec, ctx: Ctx): RGB {
	const limit = toNumber(ctx.settings.alertAbove);
	if (limit !== undefined && spec.alertValue !== undefined && spec.alertValue > limit) {
		return ALERT;
	}
	return spec.lines[0]?.colour ?? ctx.colour;
}

function graphPoints(settings: Settings): number {
	return Math.max(10, Math.min(120, toNumber(settings.graphSeconds) ?? 60));
}

function renderSpec(spec: Spec, ctx: Ctx, style: Style, faded = false): string {
	const colour = colourFor(spec, ctx);
	const readout: Readout = {
		label: spec.label,
		value: spec.readout.value,
		unit: spec.readout.unit,
		sub: spec.sub,
		subColour: spec.subColour,
		colour
	};
	if (style === "number" || spec.lines.length === 0) {
		return renderNumber({ theme: ctx.theme, readout, faded });
	}
	if (style === "gauge" && spec.fraction !== undefined && (spec.max !== undefined || spec.fraction > 0)) {
		return renderGauge({ theme: ctx.theme, readout, fraction: spec.fraction, faded });
	}
	const points = graphPoints(ctx.settings);
	const lines: Line[] = spec.lines.map((l, i) => ({
		values: ctx.hub.history(l.series, points),
		colour: i === 0 ? colour : l.colour ?? colour
	}));
	let max = spec.max;
	if (max === undefined) {
		const peak = Math.max(0, ...lines.flatMap((l) => l.values.filter(Number.isFinite)));
		max = Math.max(spec.floor ?? 1, peak * 1.15);
	}
	return renderGraph({ theme: ctx.theme, readout, lines, max, points, faded });
}

function topApps(ctx: Ctx, metric: string): string {
	const { hub, settings } = ctx;
	hub.want("proc");
	const apps = hub.snapshot<AppUsage[]>("proc") ?? [];
	const count = Math.max(1, Math.min(5, toNumber(settings.count) ?? 3));
	const byMemory = metric === "memory";
	const sorted = [...apps].sort((a, b) => (byMemory ? b.rss - a.rss : b.cpu - a.cpu)).slice(0, count);
	const cores = hub.snapshot<number>("cpu.count") ?? os.cpus().length;
	const total = os.totalmem();
	return renderList({
		theme: ctx.theme,
		label: byMemory ? "Top memory" : "Top CPU",
		colour: ctx.colour,
		rows: sorted.map((a) => ({
			name: a.name,
			value: byMemory ? compact(bytes(a.rss)) : `${Math.round(a.cpu)}%`,
			fraction: byMemory ? a.rss / total : a.cpu / (100 * cores)
		}))
	});
}

function watchedApp(ctx: Ctx, metric: string): string {
	const { hub, settings } = ctx;
	const name = settings.app?.trim();
	if (!name) {
		return renderMessage({ theme: ctx.theme, label: "App", message: "Pick an app" });
	}
	hub.want(`app:${name}`);
	const running = hub.latest(`app.${name}.up`) === 1;
	const shown = hub.snapshot<string>(`app.${name}.name`) ?? name;
	const byMemory = metric === "memory";
	const v = hub.latest(byMemory ? `app.${name}.rss` : `app.${name}.cpu`);
	const spec: Spec = {
		label: shown,
		readout: !running ? { value: "off", unit: "" } : byMemory ? bytes(v) : percent(v),
		sub: running ? (byMemory ? "memory" : "CPU") : "not running",
		lines: [{ series: byMemory ? `app.${name}.rss` : `app.${name}.cpu` }],
		floor: byMemory ? 256 * 1024 ** 2 : 100,
		fraction: byMemory ? (v ?? 0) / os.totalmem() : Math.min(1, (v ?? 0) / 100),
		alertValue: byMemory ? (v ?? 0) / 1024 ** 3 : v
	};
	// A closed app fades out rather than disappearing, like an unplugged device.
	return renderSpec(spec, ctx, settings.style ?? "graph", !running && hub.latest(`app.${name}.up`) !== undefined);
}

/** Renders one key. Also registers the key's demand with the hub as a side effect. */
export function face(hub: Hub, category: Category, settings: Settings, now = Date.now()): string {
	const ctx: Ctx = {
		hub,
		settings,
		now,
		colour: accent(settings.colour, DEFAULT_ACCENT[category]),
		theme: theme(settings.theme)
	};
	const metric = metricOf(category, settings);
	const style = settings.style ?? "graph";

	switch (category) {
		case "cpu": {
			const spec = cpu(ctx, metric);
			if (spec === "cores") {
				const count = hub.snapshot<number>("cpu.count") ?? os.cpus().length;
				const cores = Array.from({ length: count }, (_, i) => hub.latest(`cpu.core.${i}`) ?? 0);
				return renderCores({ theme: ctx.theme, label: "Cores", value: compact(percent(hub.latest("cpu.total"))).replace(" ", ""), cores, colour: ctx.colour });
			}
			return renderSpec(spec, ctx, style);
		}
		case "memory":
			return renderSpec(memory(ctx, metric), ctx, style);
		case "gpu": {
			const spec = gpu(ctx, metric);
			if (hub.latest("gpu.device") === undefined && hub.history("cpu.total").length > 3) {
				return renderMessage({ theme: ctx.theme, label: "GPU", message: "No GPU stats" });
			}
			return renderSpec(spec, ctx, style);
		}
		case "disk":
			return renderSpec(disk(ctx, metric), ctx, style);
		case "network":
			return renderSpec(network(ctx, metric), ctx, metric === "minute" || metric === "hour" || metric === "day" ? (style === "graph" ? "number" : style) : style);
		case "ping":
			return renderSpec(ping(ctx), ctx, style);
		case "system": {
			const spec = system(ctx, metric);
			if ("message" in spec) return renderMessage({ theme: ctx.theme, label: spec.label, message: spec.message });
			return renderSpec(spec, ctx, style);
		}
		case "top":
			return topApps(ctx, metric);
		case "app":
			return watchedApp(ctx, metric);
	}
}
