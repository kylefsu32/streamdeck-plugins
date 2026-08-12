import streamDeck from "@elgato/streamdeck";

import { TranscriptScanner } from "./scanner";
import type { UsageSample } from "./types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * One scanner shared by every visible action.
 *
 * Actions subscribe rather than polling themselves, so adding a second ring key
 * costs nothing extra — the transcripts are read once per tick regardless of how
 * many keys are on the canvas.
 */
export class UsageService {
	readonly #scanner: TranscriptScanner;
	readonly #subscribers = new Set<() => void>();

	#timer: NodeJS.Timeout | undefined;
	#intervalMs = 20_000;
	#scanning = false;
	#lastScanAt = 0;

	constructor() {
		this.#scanner = new TranscriptScanner({ retentionMs: 8 * DAY });
	}

	get samples(): readonly UsageSample[] {
		return this.#scanner.samples;
	}

	get root(): string {
		return this.#scanner.root;
	}

	get lastError(): string | undefined {
		return this.#scanner.lastError;
	}

	get lastScanAt(): number {
		return this.#lastScanAt;
	}

	/** Ensures history reaches back far enough for the widest window in use. */
	requireWindow(ms: number): void {
		const needed = ms + DAY;
		if (needed > this.#scanner.retentionMs) {
			this.#scanner.retentionMs = needed;
		}
	}

	setInterval(ms: number): void {
		const next = Math.max(5_000, Math.min(600_000, ms));
		if (next === this.#intervalMs) {
			return;
		}
		this.#intervalMs = next;
		if (this.#timer) {
			this.#stopTimer();
			this.#startTimer();
		}
	}

	subscribe(listener: () => void): () => void {
		this.#subscribers.add(listener);
		if (this.#subscribers.size === 1) {
			this.#startTimer();
		}
		// Give the newcomer whatever we already have, then refresh.
		listener();
		void this.refresh();

		return () => {
			this.#subscribers.delete(listener);
			if (this.#subscribers.size === 0) {
				this.#stopTimer();
			}
		};
	}

	async refresh(): Promise<void> {
		if (this.#scanning) {
			return;
		}
		this.#scanning = true;
		try {
			await this.#scanner.scan();
			this.#lastScanAt = Date.now();
		} catch (err) {
			streamDeck.logger.error("usage scan failed", err);
		} finally {
			this.#scanning = false;
		}
		this.#notify();
	}

	#notify(): void {
		for (const listener of this.#subscribers) {
			try {
				listener();
			} catch (err) {
				streamDeck.logger.error("subscriber threw", err);
			}
		}
	}

	#startTimer(): void {
		this.#stopTimer();
		// Not unref'd: the plugin process should stay alive while keys are on the
		// canvas, and the Stream Deck app decides when it stops.
		this.#timer = setInterval(() => void this.refresh(), this.#intervalMs);
	}

	#stopTimer(): void {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		}
	}
}

export const usageService = new UsageService();
