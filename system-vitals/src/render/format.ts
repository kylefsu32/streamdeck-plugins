export type Formatted = { value: string; unit: string };

const DASH = "—";

function num(n: number, decimals: number): string {
	return n.toFixed(decimals);
}

/** Two or three significant digits, which is all a key has room for. */
function sig(n: number): string {
	if (n >= 100) return num(n, 0);
	if (n >= 10) return num(n, 1);
	return num(n, n === 0 ? 0 : 2);
}

export function percent(v: number | undefined): Formatted {
	if (v === undefined || !Number.isFinite(v)) return { value: DASH, unit: "%" };
	return { value: num(Math.round(v), 0), unit: "%" };
}

/** Binary units, as macOS reports memory. */
export function bytes(v: number | undefined): Formatted {
	if (v === undefined || !Number.isFinite(v)) return { value: DASH, unit: "" };
	const units = ["B", "KB", "MB", "GB", "TB"];
	let n = v;
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return { value: i === 0 ? num(n, 0) : sig(n), unit: units[i]! };
}

/** Decimal units for throughput, matching what Finder and network tools show. */
export function rate(v: number | undefined, bits = false): Formatted {
	if (v === undefined || !Number.isFinite(v)) return { value: DASH, unit: bits ? "Mb/s" : "MB/s" };
	const units = bits ? ["b/s", "Kb/s", "Mb/s", "Gb/s"] : ["B/s", "KB/s", "MB/s", "GB/s"];
	let n = Math.max(0, bits ? v * 8 : v);
	let i = 0;
	while (n >= 1000 && i < units.length - 1) {
		n /= 1000;
		i++;
	}
	return { value: i === 0 ? num(n, 0) : sig(n), unit: units[i]! };
}

/** Decimal transfer totals. */
export function volume(v: number | undefined): Formatted {
	if (v === undefined || !Number.isFinite(v)) return { value: DASH, unit: "" };
	const units = ["B", "KB", "MB", "GB", "TB"];
	let n = Math.max(0, v);
	let i = 0;
	while (n >= 1000 && i < units.length - 1) {
		n /= 1000;
		i++;
	}
	return { value: i === 0 ? num(n, 0) : sig(n), unit: units[i]! };
}

export function compact(f: Formatted): string {
	return f.unit ? `${f.value} ${f.unit}` : f.value;
}

export function duration(seconds: number): Formatted {
	const s = Math.max(0, Math.floor(seconds));
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return { value: `${d}d ${h}h`, unit: "" };
	if (h > 0) return { value: `${h}h ${m}m`, unit: "" };
	return { value: `${m}m`, unit: "" };
}

export function milliseconds(v: number | undefined): Formatted {
	if (v === undefined || !Number.isFinite(v)) return { value: DASH, unit: "ms" };
	return { value: v < 10 ? num(v, 1) : num(Math.round(v), 0), unit: "ms" };
}
