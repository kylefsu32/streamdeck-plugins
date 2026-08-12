/**
 * Launching a terminal from a key press.
 *
 * `/usage` is an interactive slash command — there is no `claude usage`
 * subcommand — so the only way to show it is to open a terminal running
 * `claude /usage`. A slash command passed as the initial prompt opens the
 * session straight into that view.
 *
 * This writes a small `.command` script and hands it to `open -a`, rather than
 * driving the terminal with AppleScript. Two reasons:
 *
 *  - AppleScript needs Stream Deck to hold Automation permission for that
 *    specific terminal. The first press would raise a TCC prompt, and a missed
 *    or denied prompt leaves the key silently doing nothing. `open` is a launch,
 *    not an Apple event, so no permission is involved.
 *  - It works with any terminal by name — Terminal, iTerm, Ghostty, WezTerm —
 *    instead of needing hand-written scripting terminology per app.
 *
 * The script re-execs through the user's login shell because `claude` usually
 * lives in `~/.local/bin`, which is not on the bare PATH a `.command` inherits.
 */

import { spawn } from "node:child_process";
import { writeFile, chmod } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import streamDeck from "@elgato/streamdeck";

export type LongPressMode = "usage" | "command" | "none";

/** Long-press settings, mixed into each action's own settings. */
export type LongPressSettings = {
	longPress?: LongPressMode;
	/** May arrive as a string from the property inspector. */
	longPressMs?: number | string;
	longPressCommand?: string;
	/** Application name passed to `open -a`. Defaults to Terminal. */
	terminalApp?: string;
	/** Directory the `/usage` session opens in. Defaults to home. */
	usageDir?: string;
};

export const DEFAULT_LONG_PRESS_MS = 600;
export const DEFAULT_TERMINAL = "Terminal";

/** Escapes a string for embedding in a POSIX single-quoted shell literal. */
function shellSingleQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function loginShell(): string {
	const shell = process.env["SHELL"];
	return shell && shell.trim().length > 0 ? shell : "/bin/zsh";
}

function expandHome(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) {
		return homedir();
	}
	return trimmed.replace(/^~(?=$|\/)/, homedir());
}

/** Fire-and-forget; the plugin must not wait on, or be held open by, the child. */
function detach(command: string, args: string[], capture = false): void {
	const child = spawn(command, args, {
		detached: !capture,
		stdio: capture ? ["ignore", "ignore", "pipe"] : "ignore"
	});

	child.on("error", (err) => streamDeck.logger.error(`failed to launch ${command}`, err));

	if (capture && child.stderr) {
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("close", (code) => {
			if (code !== 0) {
				streamDeck.logger.error(`${command} exited ${code}: ${stderr.trim()}`);
			}
		});
	}

	child.unref();
}

/**
 * Writes the launcher script. A fixed filename is reused rather than a unique
 * one so repeated presses do not litter the temp directory.
 */
async function writeLauncher(innerCommand: string): Promise<string> {
	const file = path.join(tmpdir(), "claude-usage-open.command");
	const script = `#!/bin/sh\nexec ${shellSingleQuote(loginShell())} -l -c ${shellSingleQuote(innerCommand)}\n`;
	await writeFile(file, script, "utf8");
	await chmod(file, 0o755);
	return file;
}

/** Opens a terminal showing Claude Code's own `/usage` view. */
export function openUsage(settings: LongPressSettings): void {
	const dir = expandHome(settings.usageDir);

	if (process.platform === "win32") {
		detach("cmd.exe", ["/c", "start", "cmd", "/k", "claude", "/usage"]);
		return;
	}

	const app = settings.terminalApp?.trim() || DEFAULT_TERMINAL;
	const inner = `cd ${shellSingleQuote(dir)} && exec claude /usage`;

	void writeLauncher(inner)
		.then((file) => detach("open", ["-a", app, file], true))
		.catch((err) => streamDeck.logger.error("could not write the /usage launcher", err));
}

/** Runs an arbitrary shell command, for the custom long-press option. */
export function runCommand(command: string): void {
	const trimmed = command.trim();
	if (trimmed.length === 0) {
		return;
	}
	if (process.platform === "win32") {
		detach("cmd.exe", ["/c", trimmed]);
		return;
	}
	// Through the login shell, so the command sees the PATH the user expects.
	detach(loginShell(), ["-l", "-c", trimmed]);
}

export function longPressThreshold(settings: LongPressSettings): number {
	const value = Number(settings.longPressMs);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_LONG_PRESS_MS;
}

/** Runs the configured long-press action. Returns false when there is nothing to do. */
export function performLongPress(settings: LongPressSettings): boolean {
	switch (settings.longPress ?? "usage") {
		case "usage":
			openUsage(settings);
			return true;
		case "command": {
			const command = settings.longPressCommand?.trim();
			if (!command) {
				return false;
			}
			runCommand(command);
			return true;
		}
		default:
			return false;
	}
}
