/**
 * Anthropic's own usage figures — the same source `/usage` reads.
 *
 * `GET https://api.anthropic.com/api/oauth/usage` returns the real utilization
 * and reset time for both limit windows, so nothing here needs calibrating:
 *
 *   { "five_hour": { "utilization": 33.0, "resets_at": "2026-…" },
 *     "seven_day": { "utilization": 13.0, "resets_at": "2026-…" } }
 *
 * The endpoint is undocumented and could change. Two behaviours are load-bearing
 * and were learned the hard way:
 *
 *  - **The User-Agent must look like Claude Code.** Anything else is served an
 *    aggressively rate-limited bucket that returns persistent 429s. This cost me
 *    an hour and put the account in a penalty box.
 *  - **A failure must trigger a cooldown, not a retry.** Every visible key asks
 *    for a redraw; without a cooldown a failure makes each of them fire its own
 *    request, so the request rate goes *up* exactly when the API is asking for
 *    less. (Both observed in saeedkolivand/claude-usage-streamdeck-plugin.)
 */

import streamDeck from "@elgato/streamdeck";

import { readOAuthToken } from "../system/credentials";

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

/** Must be a claude-code agent; see the note above. */
const USER_AGENT = process.env["CLAUDE_USAGE_UA"] || "claude-code/2.1.147";

/** One network call a minute, however many keys are on the canvas. */
const CACHE_TTL_MS = 55_000;

/** Roughly three missed polls: worth telling the user the numbers have aged. */
const STALE_AFTER_MS = 3 * 60_000;

const log = streamDeck.logger.createScope("limits");

export type LimitWindow = {
	/** 0..1, converted from the API's percentage. */
	fraction: number;
	/** Epoch milliseconds of the reset, when the API supplies one. */
	resetsAt?: number;
};

export type LimitsSnapshot = {
	fiveHour?: LimitWindow;
	sevenDay?: LimitWindow;
	/** When these numbers were actually fetched. 0 means never. */
	fetchedAt: number;
	stale: boolean;
	error?: string;
};

function parseWindow(node: unknown): LimitWindow | undefined {
	if (!node || typeof node !== "object") {
		return undefined;
	}
	const raw = node as { utilization?: unknown; resets_at?: unknown };
	const utilization = typeof raw.utilization === "number" ? raw.utilization : Number(raw.utilization);
	if (!Number.isFinite(utilization)) {
		return undefined;
	}

	let resetsAt: number | undefined;
	if (typeof raw.resets_at === "string") {
		const parsed = Date.parse(raw.resets_at);
		if (Number.isFinite(parsed)) {
			resetsAt = parsed;
		}
	}

	// The API reports a percentage; everything downstream works in 0..1.
	return { fraction: utilization / 100, resetsAt };
}

export class LimitsService {
	readonly #subscribers = new Set<() => void>();

	#snapshot: LimitsSnapshot = { fetchedAt: 0, stale: false };
	#lastFailureAt = 0;
	#inFlight: Promise<void> | undefined;
	#timer: NodeJS.Timeout | undefined;

	get snapshot(): LimitsSnapshot {
		return this.#snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.#subscribers.add(listener);
		if (this.#subscribers.size === 1) {
			this.#timer = setInterval(() => void this.refresh(), CACHE_TTL_MS + 5_000);
		}
		listener();
		void this.refresh();

		return () => {
			this.#subscribers.delete(listener);
			if (this.#subscribers.size === 0 && this.#timer) {
				clearInterval(this.#timer);
				this.#timer = undefined;
			}
		};
	}

	/** `force` bypasses both the cache and the failure cooldown — for a keypress. */
	async refresh(force = false): Promise<void> {
		const now = Date.now();

		if (!force) {
			if (this.#snapshot.fetchedAt > 0 && now - this.#snapshot.fetchedAt < CACHE_TTL_MS) {
				return;
			}
			if (this.#lastFailureAt > 0 && now - this.#lastFailureAt < CACHE_TTL_MS) {
				return; // cooldown: serve what we have rather than pile on
			}
		}

		// Collapse concurrent callers onto one request.
		this.#inFlight ??= this.#fetch().finally(() => {
			this.#inFlight = undefined;
		});
		await this.#inFlight;
	}

	async #fetch(): Promise<void> {
		try {
			const { accessToken } = await readOAuthToken();

			const response = await fetch(ENDPOINT, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"anthropic-beta": "oauth-2025-04-20",
					"User-Agent": USER_AGENT,
					"Content-Type": "application/json",
					Accept: "application/json, text/plain, */*"
				},
				signal: AbortSignal.timeout(20_000)
			});

			if (!response.ok) {
				this.#fail(`http ${response.status}`);
				return;
			}

			const body = (await response.json()) as { five_hour?: unknown; seven_day?: unknown };
			const fiveHour = parseWindow(body.five_hour);
			const sevenDay = parseWindow(body.seven_day);

			if (!fiveHour && !sevenDay) {
				// Shape changed; say so rather than quietly showing zeros.
				this.#fail(`unexpected response keys: ${Object.keys(body ?? {}).join(", ") || "none"}`);
				return;
			}

			this.#lastFailureAt = 0;
			this.#snapshot = { fiveHour, sevenDay, fetchedAt: Date.now(), stale: false };
			log.debug(
				`limits ok — 5h=${fiveHour ? (fiveHour.fraction * 100).toFixed(1) : "?"}%` +
					` 7d=${sevenDay ? (sevenDay.fraction * 100).toFixed(1) : "?"}%`
			);
		} catch (err) {
			this.#fail(err instanceof Error ? err.message : String(err));
		}

		this.#notify();
	}

	#fail(error: string): void {
		this.#lastFailureAt = Date.now();
		const age = this.#snapshot.fetchedAt > 0 ? Date.now() - this.#snapshot.fetchedAt : Infinity;
		// Keep the last good numbers on screen; just mark them once they age.
		this.#snapshot = { ...this.#snapshot, error, stale: age > STALE_AFTER_MS };
		log.warn(`limits fetch failed: ${error}`);
	}

	#notify(): void {
		for (const listener of this.#subscribers) {
			try {
				listener();
			} catch (err) {
				log.error("subscriber threw", err);
			}
		}
	}
}

export const limitsService = new LimitsService();
