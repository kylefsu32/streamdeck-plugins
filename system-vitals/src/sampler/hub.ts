/**
 * The sampling hub.
 *
 * Keys never collect anything themselves. They tell the hub which sources they
 * need ("cpu", "net", "ping:1.1.1.1:2", …) every time they paint, and read
 * history back out by series name. A source keeps running for a while after
 * the last key that wanted it goes away, so swiping to another page and back
 * finds the graph still full instead of starting from a blank tile.
 */

import { EventEmitter } from "node:events";

export const HISTORY_LENGTH = 120;
/** How long a source keeps sampling after nobody has asked for it. */
const LINGER_MS = 10 * 60_000;
const TICK_MS = 1000;

export type Collector = {
	intervalMs: number;
	collect(hub: Hub, now: number): Promise<void>;
};

export type CollectorFactory = (key: string) => Collector | undefined;

type Slot = { collector: Collector; due: number; lastWanted: number; busy: boolean; pinned: boolean };

export class Hub extends EventEmitter {
	readonly #series = new Map<string, number[]>();
	readonly #snapshots = new Map<string, unknown>();
	readonly #slots = new Map<string, Slot>();
	readonly #factory: CollectorFactory;
	#timer: NodeJS.Timeout | undefined;

	constructor(factory: CollectorFactory) {
		super();
		this.#factory = factory;
	}

	/** Marks a source as needed. Cheap; call it on every paint. */
	want(key: string, now = Date.now()): void {
		const slot = this.#slots.get(key);
		if (slot) {
			slot.lastWanted = now;
			return;
		}
		const collector = this.#factory(key);
		if (!collector) {
			return;
		}
		this.#slots.set(key, { collector, due: now, lastWanted: now, busy: false, pinned: false });
		// A brand-new source runs straight away rather than waiting a tick.
		void this.#run(key, now);
	}

	/** Keeps a source running for the life of the plugin (cheap, always-useful ones). */
	pin(key: string): void {
		this.want(key);
		const slot = this.#slots.get(key);
		if (slot) {
			slot.pinned = true;
		}
	}

	record(series: string, value: number): void {
		let values = this.#series.get(series);
		if (!values) {
			values = [];
			this.#series.set(series, values);
		}
		values.push(value);
		if (values.length > HISTORY_LENGTH) {
			values.splice(0, values.length - HISTORY_LENGTH);
		}
	}

	history(series: string, count = HISTORY_LENGTH): number[] {
		const values = this.#series.get(series) ?? [];
		return values.slice(Math.max(0, values.length - count));
	}

	latest(series: string): number | undefined {
		const values = this.#series.get(series);
		return values && values.length > 0 ? values[values.length - 1] : undefined;
	}

	setSnapshot(key: string, value: unknown): void {
		this.#snapshots.set(key, value);
	}

	snapshot<T>(key: string): T | undefined {
		return this.#snapshots.get(key) as T | undefined;
	}

	start(): void {
		if (!this.#timer) {
			this.#timer = setInterval(() => void this.tick(), TICK_MS);
		}
	}

	stop(): void {
		clearInterval(this.#timer);
		this.#timer = undefined;
	}

	/** One scheduler pass: run whatever is due, drop what nobody wants, then tell keys to repaint. */
	async tick(now = Date.now()): Promise<void> {
		const runs: Promise<void>[] = [];
		for (const [key, slot] of this.#slots) {
			if (!slot.pinned && now - slot.lastWanted > LINGER_MS) {
				this.#slots.delete(key);
				continue;
			}
			if (now >= slot.due && !slot.busy) {
				runs.push(this.#run(key, now));
			}
		}
		await Promise.all(runs);
		this.emit("tick", now);
	}

	async #run(key: string, now: number): Promise<void> {
		const slot = this.#slots.get(key);
		if (!slot || slot.busy) {
			return;
		}
		slot.busy = true;
		// Schedule from the planned time, not completion, so slow tools don't drift.
		slot.due = Math.max(slot.due + slot.collector.intervalMs, now + slot.collector.intervalMs / 2);
		try {
			await slot.collector.collect(this, now);
		} catch (err) {
			this.emit("collect-error", key, err);
		} finally {
			slot.busy = false;
		}
	}
}
