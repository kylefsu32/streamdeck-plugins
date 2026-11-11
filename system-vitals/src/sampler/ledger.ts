/**
 * Running transfer totals per network interface.
 *
 * Per-second buckets cover the last minute exactly; per-minute buckets cover
 * the last 24 hours and are written to disk so the hour and day totals survive
 * a restart of the Stream Deck app (or the Mac).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DAY_MINUTES = 24 * 60;

type Buckets = { rx: number; tx: number };
type IfaceLedger = {
	seconds: Map<number, Buckets>;
	minutes: Map<number, Buckets>;
};

export class TransferLedger {
	readonly #ifaces = new Map<string, IfaceLedger>();
	readonly #file: string | undefined;
	#dirty = false;
	#lastSave = 0;

	constructor(file?: string) {
		this.#file = file;
		this.#load();
	}

	add(iface: string, rx: number, tx: number, now: number): void {
		if (rx <= 0 && tx <= 0) {
			return;
		}
		const ledger = this.#ledger(iface);
		bump(ledger.seconds, Math.floor(now / 1000), rx, tx);
		bump(ledger.minutes, Math.floor(now / 60_000), rx, tx);
		this.#dirty = true;
		this.#prune(ledger, now);
		if (now - this.#lastSave > 60_000) {
			this.save(now);
		}
	}

	/** Bytes moved over the trailing window. Windows up to a minute are second-exact. */
	total(iface: string, windowMs: number, now: number): Buckets {
		const ledger = this.#ifaces.get(iface);
		const sum = { rx: 0, tx: 0 };
		if (!ledger) {
			return sum;
		}
		if (windowMs <= 60_000) {
			const from = Math.floor((now - windowMs) / 1000);
			for (const [s, b] of ledger.seconds) {
				if (s > from) {
					sum.rx += b.rx;
					sum.tx += b.tx;
				}
			}
			return sum;
		}
		const from = Math.floor((now - windowMs) / 60_000);
		for (const [m, b] of ledger.minutes) {
			if (m > from) {
				sum.rx += b.rx;
				sum.tx += b.tx;
			}
		}
		return sum;
	}

	save(now = Date.now()): void {
		this.#lastSave = now;
		if (!this.#file || !this.#dirty) {
			return;
		}
		const data: Record<string, [number, number, number][]> = {};
		for (const [iface, ledger] of this.#ifaces) {
			data[iface] = [...ledger.minutes].map(([m, b]) => [m, b.rx, b.tx]);
		}
		try {
			mkdirSync(path.dirname(this.#file), { recursive: true });
			writeFileSync(this.#file, JSON.stringify({ version: 1, minutes: data }));
			this.#dirty = false;
		} catch {
			// A read-only home is not worth crashing over; totals just won't persist.
		}
	}

	#load(): void {
		if (!this.#file) {
			return;
		}
		try {
			const parsed = JSON.parse(readFileSync(this.#file, "utf8")) as { minutes?: Record<string, [number, number, number][]> };
			const cutoff = Math.floor(Date.now() / 60_000) - DAY_MINUTES;
			for (const [iface, rows] of Object.entries(parsed.minutes ?? {})) {
				const ledger = this.#ledger(iface);
				for (const [m, rx, tx] of rows) {
					if (m > cutoff) {
						ledger.minutes.set(m, { rx, tx });
					}
				}
			}
		} catch {
			// First run, or a corrupt file: start fresh.
		}
	}

	#ledger(iface: string): IfaceLedger {
		let ledger = this.#ifaces.get(iface);
		if (!ledger) {
			ledger = { seconds: new Map(), minutes: new Map() };
			this.#ifaces.set(iface, ledger);
		}
		return ledger;
	}

	#prune(ledger: IfaceLedger, now: number): void {
		const sec = Math.floor(now / 1000) - 120;
		for (const s of ledger.seconds.keys()) {
			if (s < sec) ledger.seconds.delete(s);
		}
		if (ledger.minutes.size > DAY_MINUTES + 5) {
			const min = Math.floor(now / 60_000) - DAY_MINUTES;
			for (const m of ledger.minutes.keys()) {
				if (m <= min) ledger.minutes.delete(m);
			}
		}
	}
}

function bump(map: Map<number, Buckets>, key: number, rx: number, tx: number): void {
	const b = map.get(key) ?? { rx: 0, tx: 0 };
	b.rx += Math.max(0, rx);
	b.tx += Math.max(0, tx);
	map.set(key, b);
}

/** Per-user data folder that survives plugin updates (the .sdPlugin folder doesn't). */
export function dataFile(name: string): string {
	const id = "com.kylefsu.system-vitals";
	if (process.platform === "darwin") {
		return path.join(homedir(), "Library", "Application Support", id, name);
	}
	if (process.platform === "win32") {
		return path.join(process.env["APPDATA"] ?? homedir(), id, name);
	}
	return path.join(process.env["XDG_DATA_HOME"] ?? path.join(homedir(), ".local", "share"), id, name);
}
