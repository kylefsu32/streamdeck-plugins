import { exec, execFile } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Open a terminal window on this machine running `claude`, so the user can
 * sign in or let Claude Code refresh its token.
 *
 * macOS: writing a .command file and `open`ing it launches Terminal without
 * Apple Events automation permission (osascript would prompt). The login-shell
 * shebang picks up the user's PATH so `claude` resolves wherever it lives.
 * Windows: `start` a new console with /k so a failure stays readable.
 */
export async function launchClaudeTerminal(): Promise<void> {
	if (process.platform === "darwin") {
		const script = join(tmpdir(), "claude-gauges-launch.command");
		await writeFile(script, "#!/bin/zsh -l\nexec claude\n", "utf8");
		// The pack step cannot ship exec bits, so the file is created at runtime.
		await chmod(script, 0o755);
		// execFile passes the path as argv with no shell parsing, so an exotic
		// TMPDIR (spaces, $, backticks) cannot break or inject anything.
		await execFileAsync("open", [script]);
	} else if (process.platform === "win32") {
		await execAsync('start "Claude Code" cmd /k claude');
	} else {
		throw new Error(`Unsupported platform: ${process.platform}`);
	}
}
