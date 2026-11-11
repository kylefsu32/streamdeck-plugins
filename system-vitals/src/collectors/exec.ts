import { execFile } from "node:child_process";

/**
 * Runs a command and resolves with its stdout, or undefined if it fails, times
 * out, or is not installed. Collectors treat a missing reading as "no data"
 * rather than an error, so a single flaky tool never takes a key down.
 */
export function run(command: string, args: string[], timeoutMs = 4000): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(
			command,
			args,
			{ timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
			(err, stdout) => {
				// ping exits non-zero on a lost packet but still prints useful output.
				if (err && !stdout) {
					resolve(undefined);
					return;
				}
				resolve(String(stdout));
			}
		);
	});
}
