/**
 * Pure parsers for the macOS command-line tools the collectors shell out to.
 *
 * Everything here is deliberately side-effect free so it can be tested against
 * captured output on any OS. None of these tools need sudo.
 */

export type VmStat = {
	pageSize: number;
	free: number;
	active: number;
	inactive: number;
	speculative: number;
	wired: number;
	purgeable: number;
	fileBacked: number;
	anonymous: number;
	compressed: number;
};

/** `vm_stat` — page counts, plus the page size from its header line. */
export function parseVmStat(text: string): VmStat | undefined {
	const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? NaN);
	if (!Number.isFinite(pageSize)) {
		return undefined;
	}
	const pages = (label: string): number => {
		const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s+(\\d+)`, "m");
		return Number(re.exec(text)?.[1] ?? 0);
	};
	return {
		pageSize,
		free: pages("Pages free"),
		active: pages("Pages active"),
		inactive: pages("Pages inactive"),
		speculative: pages("Pages speculative"),
		wired: pages("Pages wired down"),
		purgeable: pages("Pages purgeable"),
		fileBacked: pages("File-backed pages"),
		anonymous: pages("Anonymous pages"),
		compressed: pages("Pages occupied by compressor")
	};
}

/**
 * Memory in use the way Activity Monitor counts it: app memory + wired +
 * compressed. File cache is excluded because macOS hands it back on demand,
 * which is why `os.freemem()` on a Mac always looks alarmingly low.
 */
export function memoryUsedBytes(vm: VmStat): number {
	const app = Math.max(0, vm.anonymous - vm.purgeable);
	return (app + vm.wired + vm.compressed) * vm.pageSize;
}

/** `sysctl -n vm.swapusage` → bytes used / total. */
export function parseSwap(text: string): { used: number; total: number } | undefined {
	const total = /total = ([\d.]+)([KMG])/.exec(text);
	const used = /used = ([\d.]+)([KMG])/.exec(text);
	if (!total || !used) {
		return undefined;
	}
	return { total: unitBytes(total[1]!, total[2]!), used: unitBytes(used[1]!, used[2]!) };
}

function unitBytes(n: string, unit: string): number {
	const scale = unit === "G" ? 1024 ** 3 : unit === "M" ? 1024 ** 2 : 1024;
	return Number(n) * scale;
}

export type InterfaceCounters = { rx: number; tx: number };

/**
 * `netstat -ibn` — cumulative bytes per interface.
 *
 * Each interface appears once per address; only the `<Link#n>` row carries the
 * hardware counters we want. The address column is blank for some interfaces,
 * so the byte columns are taken counting back from the end of the row, where
 * the layout is fixed: Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll.
 */
export function parseNetstat(text: string): Map<string, InterfaceCounters> {
	const result = new Map<string, InterfaceCounters>();
	for (const line of text.split("\n")) {
		const cols = line.trim().split(/\s+/);
		if (cols.length < 9 || !cols[2]?.startsWith("<Link#")) {
			continue;
		}
		const name = cols[0]!.replace(/\*$/, "");
		const rx = Number(cols[cols.length - 5]);
		const tx = Number(cols[cols.length - 2]);
		if (!Number.isFinite(rx) || !Number.isFinite(tx) || result.has(name)) {
			continue;
		}
		result.set(name, { rx, tx });
	}
	return result;
}

/**
 * Interfaces that represent real traffic. Tunnels (utun), AirDrop (awdl, llw),
 * bridges and loopback either double-count or are noise.
 */
export function isPhysicalInterface(name: string): boolean {
	return /^en\d+$/.test(name);
}

export type GpuStats = {
	device: number;
	renderer: number;
	tiler: number;
	/** Bytes of unified memory the GPU currently has in use. */
	memory: number;
};

/**
 * `ioreg -r -d 1 -w 0 -c IOAccelerator` — Apple Silicon (and most Intel/AMD Mac
 * GPUs) publish live utilisation in `PerformanceStatistics`, readable without
 * root. Several accelerators may be listed; the busiest wins.
 */
export function parseGpu(text: string): GpuStats | undefined {
	let best: GpuStats | undefined;
	for (const block of text.split(/"PerformanceStatistics" = /).slice(1)) {
		const body = block.slice(0, block.indexOf("}") + 1);
		const num = (key: string): number => {
			const m = new RegExp(`"${key.replace(/[%()]/g, "\\$&")}"=(\\d+)`).exec(body);
			return m ? Number(m[1]) : NaN;
		};
		const device = num("Device Utilization %");
		if (!Number.isFinite(device)) {
			continue;
		}
		const stats: GpuStats = {
			device,
			renderer: num("Renderer Utilization %"),
			tiler: num("Tiler Utilization %"),
			memory: num("In use system memory")
		};
		if (!best || stats.device > best.device) {
			best = stats;
		}
	}
	return best;
}

/**
 * `ioreg -r -c IOBlockStorageDriver -w 0 -d 1` — cumulative bytes read and
 * written, summed across every block device (internal and external).
 */
export function parseDiskIo(text: string): { read: number; write: number } | undefined {
	let read = 0;
	let write = 0;
	let found = false;
	for (const m of text.matchAll(/"Statistics" = \{([^}]*)\}/g)) {
		const body = m[1]!;
		const r = /"Bytes \(Read\)"=(\d+)/.exec(body);
		const w = /"Bytes \(Write\)"=(\d+)/.exec(body);
		if (r || w) {
			found = true;
			read += Number(r?.[1] ?? 0);
			write += Number(w?.[1] ?? 0);
		}
	}
	return found ? { read, write } : undefined;
}

/** `ping -c 1` → round-trip in ms, or undefined when the packet was lost. */
export function parsePing(text: string): number | undefined {
	const m = /time[=<]([\d.]+)\s*ms/.exec(text);
	return m ? Number(m[1]) : undefined;
}

export type Battery = { percent: number; state: string; remaining?: string };

/** `pmset -g batt`. Desktops have no InternalBattery line and return undefined. */
export function parseBattery(text: string): Battery | undefined {
	const line = text.split("\n").find((l) => l.includes("InternalBattery"));
	if (!line) {
		return undefined;
	}
	const percent = Number(/(\d+)%/.exec(line)?.[1] ?? NaN);
	if (!Number.isFinite(percent)) {
		return undefined;
	}
	const state = /%;\s*([^;]+);/.exec(line)?.[1]?.trim() ?? "";
	const remaining = /(\d+:\d+) remaining/.exec(line)?.[1];
	return { percent, state, remaining };
}

export type ProcessRow = { pid: number; cpu: number; rss: number; name: string };

/** `ps -Aco pid=,pcpu=,rss=,comm=` — rss is in KiB. */
export function parsePs(text: string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of text.split("\n")) {
		const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
		if (!m) {
			continue;
		}
		rows.push({ pid: Number(m[1]), cpu: Number(m[2]), rss: Number(m[3]) * 1024, name: m[4]! });
	}
	return rows;
}

/**
 * Folds helper processes into the app that owns them, so "Google Chrome
 * Helper (Renderer)" counts towards "Google Chrome" the way people think
 * about it.
 */
export function appName(processName: string): string {
	return processName.replace(/\s+Helper(\s*\(.*\))?$/i, "").replace(/\s+Web Content$/i, "").trim() || processName;
}

export type AppUsage = { name: string; cpu: number; rss: number; count: number };

export function groupByApp(rows: ProcessRow[]): AppUsage[] {
	const apps = new Map<string, AppUsage>();
	for (const row of rows) {
		if (row.pid === 0 || row.name === "kernel_task" && row.cpu === 0) {
			continue;
		}
		const name = appName(row.name);
		const app = apps.get(name) ?? { name, cpu: 0, rss: 0, count: 0 };
		app.cpu += row.cpu;
		app.rss += row.rss;
		app.count += 1;
		apps.set(name, app);
	}
	return [...apps.values()];
}
