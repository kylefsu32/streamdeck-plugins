import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Everything the hook and the plugin share lives under one folder in the
 * Claude config directory. Plain files, not a socket: a hook that fires while
 * the Stream Deck app is closed still leaves the right state behind, and the
 * deck catches up the moment it starts.
 */
export function claudeHome(): string {
	return process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude");
}

export function harnessHome(): string {
	return path.join(claudeHome(), "streamdeck-harness");
}

export const paths = {
	sessions: () => path.join(harnessHome(), "sessions"),
	session: (id: string) => path.join(harnessHome(), "sessions", `${safeName(id)}.json`),
	answers: () => path.join(harnessHome(), "answers"),
	answer: (questionId: string) => path.join(harnessHome(), "answers", `${safeName(questionId)}.json`),
	config: () => path.join(harnessHome(), "config.json"),
	heartbeat: () => path.join(harnessHome(), "deck.json"),
	settings: () => path.join(claudeHome(), "settings.json")
};

/** Session ids are UUIDs, but nothing from stdin gets to pick a path. */
export function safeName(id: string): string {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

export function readJson<T>(file: string): T | undefined {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
}

/**
 * Write-then-rename, so a reader never sees half a file. Parallel tool calls
 * fire hooks concurrently for the same session; the last rename wins, which is
 * also the newest event.
 */
export function writeJsonAtomic(file: string, value: unknown, indent: string | number = "\t"): void {
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, indent)}\n`);
	renameSync(tmp, file);
}
