// Copied from ../claude-gauges/src/lib/usage-client.ts in this repo (same author); each plugin stays self-contained.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
// The usage endpoint serves a separate, aggressively rate-limited bucket to
// unrecognized clients; the UA must start with "claude-code/".
const USER_AGENT = "claude-code/2.0.31";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/**
 * Minimum age before a non-forced poll re-fetches. Community consensus for this
 * endpoint is a ~55-60s shared cache floor; applies to failures too so error
 * paths never amplify the request rate.
 */
const MIN_FETCH_INTERVAL_MS = 55_000;

/**
 * Floor for manual (key press) refreshes: short enough to feel responsive,
 * but mashing the key can never exceed one request per window, even in error
 * states where each attempt would also spawn a keychain read.
 */
const FORCE_FLOOR_MS = 10_000;

export type MetricKey = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet";

export const METRIC_KEYS: MetricKey[] = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];

export const METRIC_LABELS: Record<MetricKey, { short: string; long: string }> = {
	five_hour: { short: "5-HR", long: "SESSION (5H)" },
	seven_day: { short: "WEEK", long: "WEEK (ALL)" },
	seven_day_opus: { short: "OPUS", long: "WEEK (OPUS)" },
	seven_day_sonnet: { short: "SONNET", long: "WEEK (SONNET)" }
};

export type MetricReading = {
	/** 0-100 */
	utilization: number;
	/** Epoch ms of the window reset, or null if unknown. */
	resetsAt: number | null;
};

export type UsageErrorKind = "no-credentials" | "expired" | "network" | "http" | "parse";

export type UsageSnapshot = {
	/** Epoch ms the snapshot was taken. */
	at: number;
	metrics: Partial<Record<MetricKey, MetricReading>>;
	error?: { kind: UsageErrorKind; message: string };
};

type StoredCredentials = {
	accessToken: string;
	expiresAt: number | null;
};

async function readCredentialsFile(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

async function readKeychain(): Promise<string | null> {
	if (process.platform !== "darwin") return null;
	try {
		const { stdout } = await execFileAsync(
			"/usr/bin/security",
			["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
			{ timeout: 10_000 }
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

function parseCredentials(raw: string): StoredCredentials | null {
	try {
		const json = JSON.parse(raw);
		const oauth = json?.claudeAiOauth ?? json;
		const accessToken = oauth?.accessToken;
		if (typeof accessToken !== "string" || accessToken.length === 0) return null;
		let expiresAt: number | null = typeof oauth?.expiresAt === "number" ? oauth.expiresAt : null;
		// Guard against seconds-vs-milliseconds ambiguity.
		if (expiresAt !== null && expiresAt < 1e12) expiresAt *= 1000;
		return { accessToken, expiresAt };
	} catch {
		return null;
	}
}

/**
 * Load the Claude Code OAuth credentials from wherever this machine keeps them.
 * The plugin never refreshes tokens itself: Claude Code owns the refresh token,
 * and OAuth refresh tokens are rotated on use, so refreshing here could sign
 * Claude Code out. We only ever read what Claude Code last stored.
 */
async function loadCredentials(): Promise<StoredCredentials | null> {
	const sources = [
		await readKeychain(),
		await readCredentialsFile(join(homedir(), ".claude", ".credentials.json"))
	];
	for (const raw of sources) {
		if (!raw) continue;
		const creds = parseCredentials(raw);
		if (creds) return creds;
	}
	return null;
}

function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseResetsAt(v: unknown): number | null {
	if (typeof v === "number" && Number.isFinite(v)) {
		return v < 1e12 ? v * 1000 : v;
	}
	if (typeof v === "string") {
		const t = Date.parse(v);
		return Number.isNaN(t) ? null : t;
	}
	return null;
}

function parseMetric(v: unknown): MetricReading | null {
	if (typeof v !== "object" || v === null) return null;
	const o = v as Record<string, unknown>;
	const utilization = num(o.utilization);
	if (utilization === null) return null;
	return {
		utilization: Math.max(0, Math.min(100, utilization)),
		resetsAt: parseResetsAt(o.resets_at)
	};
}

/** Keys whose presence marks a body as a genuine usage response, even when their values are null. */
const KNOWN_RESPONSE_KEYS = [...METRIC_KEYS, "seven_day_oauth_apps", "extra_usage"];

function parseUsageResponse(json: unknown): {
	metrics: Partial<Record<MetricKey, MetricReading>>;
	recognized: boolean;
} {
	const o = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
	const metrics: Partial<Record<MetricKey, MetricReading>> = {};
	for (const key of METRIC_KEYS) {
		const m = parseMetric(o[key]);
		if (m) metrics[key] = m;
	}
	// "five_hour": null and {"utilization": null} are both contract-valid idle
	// states, so recognition is key presence, not parse success.
	const recognized = KNOWN_RESPONSE_KEYS.some((k) => k in o);
	return { metrics, recognized };
}

class UsageClient {
	private snapshot: UsageSnapshot | null = null;
	private inflight: Promise<UsageSnapshot> | null = null;

	get last(): UsageSnapshot | null {
		return this.snapshot;
	}

	/** Fetch a fresh snapshot, coalescing concurrent callers. */
	fetch(force = false): Promise<UsageSnapshot> {
		if (this.inflight) return this.inflight;
		const floor = force ? FORCE_FLOOR_MS : MIN_FETCH_INTERVAL_MS;
		if (this.snapshot && Date.now() - this.snapshot.at < floor) {
			return Promise.resolve(this.snapshot);
		}
		this.inflight = this.doFetch().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	private async doFetch(): Promise<UsageSnapshot> {
		const at = Date.now();
		const fail = (kind: UsageErrorKind, message: string): UsageSnapshot => {
			// Keep the previous metrics visible during transient failures so the
			// gauges don't blank out on one bad poll.
			const snapshot: UsageSnapshot = {
				at,
				metrics: this.snapshot?.metrics ?? {},
				error: { kind, message }
			};
			this.snapshot = snapshot;
			return snapshot;
		};

		const creds = await loadCredentials();
		if (!creds) return fail("no-credentials", "Press: sign in");
		if (creds.expiresAt !== null && creds.expiresAt <= at) {
			return fail("expired", "Press: open Claude");
		}

		let res: Response;
		try {
			res = await globalThis.fetch(USAGE_URL, {
				headers: {
					Authorization: `Bearer ${creds.accessToken}`,
					"anthropic-beta": OAUTH_BETA,
					"User-Agent": USER_AGENT,
					"Content-Type": "application/json",
					Accept: "application/json"
				},
				signal: AbortSignal.timeout(15_000)
			});
		} catch (e) {
			return fail("network", "Offline");
		}

		if (res.status === 401 || res.status === 403) return fail("expired", "Press: open Claude");
		if (!res.ok) return fail("http", `HTTP ${res.status}`);

		let json: unknown;
		try {
			json = await res.json();
		} catch (e) {
			// Only a JSON decode failure is a parse error; timeouts and dropped
			// connections during the body read are connectivity failures.
			if (e instanceof SyntaxError) return fail("parse", "Bad response");
			return fail("network", "Offline");
		}

		const { metrics, recognized } = parseUsageResponse(json);
		if (!recognized) return fail("parse", "No usage data");

		const snapshot: UsageSnapshot = { at, metrics };
		this.snapshot = snapshot;
		return snapshot;
	}
}

export const usageClient = new UsageClient();
