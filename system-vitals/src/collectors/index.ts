/**
 * Source collectors, keyed by the demand strings keys pass to `hub.want()`.
 *
 * macOS is the target: everything here reads stock command-line tools that
 * need no root and no helper app. On other platforms the Node built-ins
 * (CPU, memory, disk space, uptime, ping) still work; the rest record nothing
 * and their keys say so.
 */

import { statfs } from "node:fs/promises";
import os from "node:os";

import type { Collector, CollectorFactory, Hub } from "../sampler/hub";
import { dataFile, TransferLedger } from "../sampler/ledger";
import { run } from "./exec";
import {
	groupByApp,
	isPhysicalInterface,
	memoryUsedBytes,
	parseBattery,
	parseDiskIo,
	parseGpu,
	parseNetstat,
	parsePing,
	parsePs,
	parseSwap,
	parseVmStat,
	type AppUsage
} from "./parse";

const isMac = process.platform === "darwin";

// Previews and tests set SYSTEM_VITALS_NO_PERSIST so they never touch the real totals file.
export const ledger = new TransferLedger(process.env["SYSTEM_VITALS_NO_PERSIST"] ? undefined : dataFile("transfer.json"));

/** Turns a cumulative counter into a per-second rate, remembering the last reading. */
class Rate {
	#last: { value: number; at: number } | undefined;

	next(value: number, at: number): number | undefined {
		const prev = this.#last;
		this.#last = { value, at };
		if (!prev || at <= prev.at || value < prev.value) {
			return undefined; // first reading, or the counter reset (sleep, interface bounce)
		}
		return ((value - prev.value) * 1000) / (at - prev.at);
	}
}

function cpuCollector(): Collector {
	let prev: os.CpuInfo[] | undefined;
	return {
		intervalMs: 1000,
		async collect(hub) {
			const cpus = os.cpus();
			if (prev && prev.length === cpus.length) {
				let busyAll = 0;
				let totalAll = 0;
				let peak = 0;
				cpus.forEach((cpu, i) => {
					const before = prev![i]!.times;
					const t = cpu.times;
					const idle = t.idle - before.idle;
					const total = t.user - before.user + (t.nice - before.nice) + (t.sys - before.sys) + (t.irq - before.irq) + idle;
					const busy = total > 0 ? ((total - idle) / total) * 100 : 0;
					hub.record(`cpu.core.${i}`, busy);
					peak = Math.max(peak, busy);
					busyAll += total - idle;
					totalAll += total;
				});
				hub.record("cpu.total", totalAll > 0 ? (busyAll / totalAll) * 100 : 0);
				hub.record("cpu.peak", peak);
			}
			hub.setSnapshot("cpu.count", cpus.length);
			hub.record("cpu.load", os.loadavg()[0] ?? 0);
			prev = cpus;
		}
	};
}

function memoryCollector(): Collector {
	return {
		intervalMs: 2000,
		async collect(hub) {
			const total = os.totalmem();
			hub.setSnapshot("mem.total", total);
			let used = total - os.freemem();
			if (isMac) {
				const [vm, swap, level] = await Promise.all([
					run("vm_stat", []),
					run("sysctl", ["-n", "vm.swapusage"]),
					run("sysctl", ["-n", "kern.memorystatus_level"])
				]);
				const parsed = vm ? parseVmStat(vm) : undefined;
				if (parsed) {
					used = memoryUsedBytes(parsed);
				}
				const sw = swap ? parseSwap(swap) : undefined;
				if (sw) {
					hub.record("swap.used", sw.used);
					hub.record("swap.percent", sw.total > 0 ? (sw.used / sw.total) * 100 : 0);
				}
				// The kernel reports how much memory is *free* for its pressure logic;
				// the inverse is what Activity Monitor's pressure graph tracks.
				const free = Number(level);
				if (level && Number.isFinite(free)) {
					hub.record("mem.pressure", Math.max(0, Math.min(100, 100 - free)));
				}
			}
			hub.record("mem.used", used);
			hub.record("mem.percent", (used / total) * 100);
		}
	};
}

function gpuCollector(): Collector {
	return {
		intervalMs: 1000,
		async collect(hub) {
			if (!isMac) return;
			const out = await run("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]);
			const gpu = out ? parseGpu(out) : undefined;
			if (!gpu) return;
			hub.record("gpu.device", gpu.device);
			if (Number.isFinite(gpu.renderer)) hub.record("gpu.renderer", gpu.renderer);
			if (Number.isFinite(gpu.tiler)) hub.record("gpu.tiler", gpu.tiler);
			if (Number.isFinite(gpu.memory)) hub.record("gpu.memory", gpu.memory);
		}
	};
}

function diskIoCollector(): Collector {
	const read = new Rate();
	const write = new Rate();
	return {
		intervalMs: 1000,
		async collect(hub, now) {
			if (!isMac) return;
			const out = await run("ioreg", ["-r", "-c", "IOBlockStorageDriver", "-w", "0", "-d", "1"]);
			const io = out ? parseDiskIo(out) : undefined;
			if (!io) return;
			const r = read.next(io.read, now);
			const w = write.next(io.write, now);
			if (r === undefined || w === undefined) return;
			hub.record("disk.read", r);
			hub.record("disk.write", w);
			hub.record("disk.total", r + w);
		}
	};
}

function spaceCollector(volume: string): Collector {
	return {
		intervalMs: 30_000,
		async collect(hub) {
			const s = await statfs(volume);
			const total = s.blocks * s.bsize;
			const free = s.bavail * s.bsize;
			const used = total - free;
			hub.setSnapshot(`space:${volume}.total`, total);
			hub.record(`space:${volume}.free`, free);
			hub.record(`space:${volume}.usedBytes`, used);
			hub.record(`space:${volume}.used`, total > 0 ? (used / total) * 100 : 0);
		}
	};
}

function networkCollector(): Collector {
	const rates = new Map<string, { rx: Rate; tx: Rate }>();
	return {
		intervalMs: 1000,
		async collect(hub, now) {
			if (!isMac) return;
			const out = await run("netstat", ["-ibn"]);
			if (!out) return;
			const counters = parseNetstat(out);
			let autoRx = 0;
			let autoTx = 0;
			let haveAuto = false;
			const active: string[] = [];
			const secs = this.intervalMs / 1000;
			for (const [name, c] of counters) {
				if (name.startsWith("lo")) continue;
				let r = rates.get(name);
				if (!r) {
					r = { rx: new Rate(), tx: new Rate() };
					rates.set(name, r);
				}
				const rx = r.rx.next(c.rx, now);
				const tx = r.tx.next(c.tx, now);
				if (rx === undefined || tx === undefined) continue;
				hub.record(`net.${name}.rx`, rx);
				hub.record(`net.${name}.tx`, tx);
				if (c.rx > 0 || c.tx > 0) active.push(name);
				ledger.add(name, rx * secs, tx * secs, now);
				if (isPhysicalInterface(name)) {
					autoRx += rx;
					autoTx += tx;
					haveAuto = true;
				}
			}
			if (haveAuto) {
				hub.record("net.auto.rx", autoRx);
				hub.record("net.auto.tx", autoTx);
				ledger.add("auto", autoRx * secs, autoTx * secs, now);
			}
			hub.setSnapshot("net.interfaces", active.sort());
		}
	};
}

function pingCollector(host: string, intervalMs: number): Collector {
	const args =
		process.platform === "win32"
			? ["-n", "1", "-w", "1500", host]
			: isMac
				? ["-c", "1", "-n", "-W", "1500", host]
				: ["-c", "1", "-n", "-W", "2", host];
	return {
		intervalMs,
		async collect(hub) {
			const out = await run("ping", args, 4000);
			const ms = out ? parsePing(out) : undefined;
			// NaN marks a lost packet; the graph draws it as a gap.
			hub.record(`ping.${host}`, ms ?? NaN);
		}
	};
}

function processCollector(): Collector {
	return {
		intervalMs: 2000,
		async collect(hub) {
			if (process.platform === "win32") return;
			const out = await run("ps", ["-Aco", "pid=,pcpu=,rss=,comm="]);
			if (!out) return;
			hub.setSnapshot("proc", groupByApp(parsePs(out)));
		}
	};
}

/** One running app, matched by name against the grouped process list. */
function appCollector(name: string): Collector {
	const needle = name.toLowerCase();
	return {
		intervalMs: 2000,
		async collect(hub) {
			hub.want("proc");
			const apps = hub.snapshot<AppUsage[]>("proc");
			if (!apps) return;
			const match =
				apps.find((a) => a.name.toLowerCase() === needle) ??
				apps.filter((a) => a.name.toLowerCase().includes(needle)).sort((a, b) => b.cpu - a.cpu)[0];
			hub.record(`app.${name}.up`, match ? 1 : 0);
			hub.record(`app.${name}.cpu`, match?.cpu ?? 0);
			hub.record(`app.${name}.rss`, match?.rss ?? 0);
			hub.setSnapshot(`app.${name}.name`, match?.name);
		}
	};
}

function batteryCollector(): Collector {
	return {
		intervalMs: 20_000,
		async collect(hub) {
			if (!isMac) return;
			const out = await run("pmset", ["-g", "batt"]);
			const batt = out ? parseBattery(out) : undefined;
			hub.setSnapshot("battery", batt ?? null);
			if (batt) hub.record("battery.percent", batt.percent);
		}
	};
}

/**
 * Demand keys: `cpu`, `mem`, `gpu`, `diskio`, `net`, `proc`, `battery`,
 * `space:<path>`, `ping:<host>:<seconds>`, `app:<name>`.
 */
export const collectorFor: CollectorFactory = (key) => {
	const [kind, ...rest] = key.split(":");
	switch (kind) {
		case "cpu":
			return cpuCollector();
		case "mem":
			return memoryCollector();
		case "gpu":
			return gpuCollector();
		case "diskio":
			return diskIoCollector();
		case "net":
			return networkCollector();
		case "proc":
			return processCollector();
		case "battery":
			return batteryCollector();
		case "space":
			return spaceCollector(rest.join(":") || "/");
		case "ping": {
			const seconds = Number(rest[rest.length - 1]);
			const host = rest.slice(0, -1).join(":");
			return host ? pingCollector(host, Math.max(1, Number.isFinite(seconds) ? seconds : 2) * 1000) : undefined;
		}
		case "app":
			return rest.join(":") ? appCollector(rest.join(":")) : undefined;
		default:
			return undefined;
	}
};

export type { Hub };
