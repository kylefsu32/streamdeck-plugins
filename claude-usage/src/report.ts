/**
 * Calibration report.
 *
 * Prints what the plugin's engine currently sees, so the ceilings in the
 * property inspector can be set against real numbers instead of guesses:
 * run this, compare the windows against `/usage` in Claude Code, and enter the
 * effective-token totals that correspond to 100%.
 *
 * Usage: npm run report
 */

import { burnRatePerHour, currentSessionBlock, summarise, summariseByModel } from "./engine/aggregate";
import { TranscriptScanner } from "./engine/scanner";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// The session limit is a fixed block and gets its own section; these are the
// plain trailing windows.
const WINDOWS: { label: string; ms: number }[] = [
	{ label: "last 1h", ms: HOUR },
	{ label: "last 24h", ms: DAY },
	{ label: "last 7d  (week)", ms: 7 * DAY }
];

function clock(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function duration(ms: number): string {
	const minutes = Math.max(0, Math.round(ms / 60_000));
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

function compact(value: number): string {
	if (value < 1_000) return String(Math.round(value));
	if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`;
	if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
	return `${(value / 1_000_000_000).toFixed(2)}B`;
}

function pad(value: string, width: number): string {
	return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
	return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

async function main(): Promise<void> {
	// `npm run report -- 60` widens the history, which is handy when working out
	// what a per-model key should be filtered on.
	const argDays = Number(process.argv[2]);
	const days = Number.isFinite(argDays) && argDays > 0 ? argDays : 8;
	const scanner = new TranscriptScanner({ retentionMs: days * DAY });

	const started = Date.now();
	await scanner.scan();
	const elapsed = Date.now() - started;

	console.log("");
	console.log("Claude usage — calibration report");
	console.log("─".repeat(62));
	console.log(`transcripts   ${scanner.root}`);
	console.log(`scan          ${elapsed}ms`);
	console.log(`calls counted ${scanner.samples.length}`);
	console.log(
		`duplicate rows skipped ${scanner.duplicatesSkipped}` +
			(scanner.samples.length > 0
				? `  (naive summing would inflate totals ${(
						(scanner.duplicatesSkipped + scanner.samples.length) /
						scanner.samples.length
					).toFixed(2)}x)`
				: "")
	);
	if (scanner.lastError) {
		console.log(`warning       ${scanner.lastError}`);
	}
	console.log("");

	const now = Date.now();
	console.log(
		pad("window", 20) + padLeft("effective", 12) + padLeft("calls", 8) + padLeft("output", 11) + padLeft("cache rd", 11)
	);
	console.log("─".repeat(62));

	for (const window of WINDOWS) {
		const stat = summarise(scanner.samples, now, window.ms);
		console.log(
			pad(window.label, 20) +
				padLeft(compact(stat.effective), 12) +
				padLeft(String(stat.calls), 8) +
				padLeft(compact(stat.raw.output), 11) +
				padLeft(compact(stat.raw.cacheRead), 11)
		);
	}

	// The session limit runs in fixed 5-hour blocks, so this is the number to
	// compare against the session percentage in /usage.
	const block = currentSessionBlock(scanner.samples, now, 5 * HOUR);
	console.log("");
	console.log("session block — the 5-hour limit");
	console.log("─".repeat(62));
	if (block.active && block.start !== undefined && block.end !== undefined) {
		console.log(`used      ${compact(block.effective)} effective over ${block.calls} calls`);
		console.log(`opened    ${clock(block.start)}`);
		console.log(`resets    ${clock(block.end)}   (in ${duration(block.remainingMs ?? 0)})`);
	} else if (block.end !== undefined) {
		console.log(`used      0 — the last block ended ${clock(block.end)}`);
		console.log("          your next message opens a fresh one");
	} else {
		console.log("used      0 — no usage on record");
	}

	const rate = burnRatePerHour(scanner.samples, now, HOUR);
	console.log("");
	console.log(`burn rate (last 1h)   ${compact(rate)} effective tokens/hour`);

	// Per-model, so a model-specific key can be given its own ceiling.
	// Measure the per-model split over the block itself, so these rows add up to
	// the session figure above rather than a trailing five hours.
	const sessionMs = block.active && block.start !== undefined ? now - block.start : 5 * HOUR;

	for (const window of [
		{ label: "session block", ms: sessionMs },
		{ label: `history (${days}d)`, ms: days * DAY }
	]) {
		const rows = summariseByModel(scanner.samples, now, window.ms).filter((row) => row.stat.calls > 0);
		if (rows.length === 0) {
			continue;
		}
		console.log("");
		console.log(`per model — ${window.label}`);
		console.log(pad("model", 30) + padLeft("effective", 12) + padLeft("calls", 8) + padLeft("share", 9));
		console.log("─".repeat(59));
		const total = rows.reduce((sum, row) => sum + row.stat.effective, 0);
		for (const row of rows) {
			const share = total > 0 ? `${Math.round((row.stat.effective / total) * 100)}%` : "—";
			console.log(
				pad(row.model, 30) + padLeft(compact(row.stat.effective), 12) + padLeft(String(row.stat.calls), 8) + padLeft(share, 9)
			);
		}
	}

	console.log("");
	console.log("Set your ceilings by comparing the session and week rows above");
	console.log("against the percentages /usage reports in Claude Code. If /usage");
	console.log("says you are at 50% and the session row reads 20M, your ceiling");
	console.log("is roughly 40M. For a model-specific key, use its row in the");
	console.log("per-model tables and the substring you would filter on.");
	console.log("");
}

void main();
