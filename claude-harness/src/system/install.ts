import { copyFileSync, existsSync } from "node:fs";

import { paths, readJson, writeJsonAtomic } from "../state/paths";

/**
 * Wires the hook into Claude Code's own settings.json.
 *
 * Like OpenHarness, this never wraps the `claude` CLI: it registers a command
 * on Claude Code's documented hook events and lets Claude Code call it. The
 * entries are recognised by the plugin id in their command, so installing is
 * idempotent (an old entry is replaced, e.g. after the Stream Deck app moved
 * its bundled Node) and uninstalling removes exactly what was added.
 */

export const MARKER = "com.kylefsu.claude-harness";

/** Every event the reducer understands. None of them takes a matcher, so all tools are seen. */
export const HOOK_EVENTS = [
	"SessionStart",
	"SessionEnd",
	"UserPromptSubmit",
	"PreToolUse",
	"PostToolUse",
	"PermissionRequest",
	"Notification",
	"Stop",
	"StopFailure"
] as const;

/** PermissionRequest may hold the prompt for the deck, up to the longest hold the UI offers. */
const TIMEOUTS: Partial<Record<(typeof HOOK_EVENTS)[number], number>> = { PermissionRequest: 330 };
const DEFAULT_TIMEOUT = 5;

type HookEntry = { type: "command"; command: string; timeout?: number };
type HookGroup = { matcher?: string; hooks: HookEntry[] };
type Settings = { hooks?: Record<string, HookGroup[]>; [key: string]: unknown };

export function hookCommand(nodePath: string, hookScript: string): string {
	const q = (p: string) => `"${process.platform === "win32" ? p.replace(/\\/g, "/") : p}"`;
	return `${q(nodePath)} ${q(hookScript)}`;
}

/** Pure: returns the settings with our hooks set to `command`, or removed when command is null. */
export function withHooks(settings: Settings, command: string | null): Settings {
	const hooks: Record<string, HookGroup[]> = { ...(settings.hooks ?? {}) };

	for (const [event, groups] of Object.entries(hooks)) {
		if (!Array.isArray(groups)) continue;
		const kept = groups
			.map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? "").includes(MARKER)) }))
			.filter((g) => g.hooks.length > 0);
		if (kept.length) hooks[event] = kept;
		else delete hooks[event];
	}

	if (command) {
		for (const event of HOOK_EVENTS) {
			const entry: HookEntry = { type: "command", command, timeout: TIMEOUTS[event] ?? DEFAULT_TIMEOUT };
			hooks[event] = [...(hooks[event] ?? []), { hooks: [entry] }];
		}
	}

	const next: Settings = { ...settings, hooks };
	if (Object.keys(hooks).length === 0) delete next.hooks;
	return next;
}

export type InstallResult = "installed" | "unchanged" | "removed" | "failed";

/**
 * Applies withHooks to the real settings.json. Refuses to touch a file it
 * cannot parse: rewriting someone's settings from scratch because of a stray
 * comma would throw away everything else in it.
 */
export function applyHooks(command: string | null): { result: InstallResult; file: string; error?: string } {
	const file = paths.settings();
	let current: Settings = {};
	if (existsSync(file)) {
		const parsed = readJson<Settings>(file);
		if (!parsed || typeof parsed !== "object") {
			return { result: "failed", file, error: "settings.json is not valid JSON; left it alone" };
		}
		current = parsed;
	}

	const next = withHooks(current, command);
	if (JSON.stringify(next) === JSON.stringify(current)) return { result: "unchanged", file };

	try {
		const backup = `${file}.before-claude-harness`;
		if (existsSync(file) && !existsSync(backup)) copyFileSync(file, backup);
		writeJsonAtomic(file, next, 2);
		return { result: command ? "installed" : "removed", file };
	} catch (err) {
		return { result: "failed", file, error: String(err) };
	}
}
