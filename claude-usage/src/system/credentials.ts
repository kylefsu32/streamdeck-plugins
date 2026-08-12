/**
 * Reads Claude Code's own OAuth access token.
 *
 * On macOS this lives in the login keychain under the service
 * `Claude Code-credentials`; on Windows it is `~/.claude/.credentials.json`.
 *
 * That blob holds more than the Claude token — every authenticated MCP server's
 * credentials sit alongside it under `mcpOAuth`. Only `claudeAiOauth` is read,
 * and only the access token and its expiry are ever returned. The token is used
 * for exactly one thing: an authenticated GET to Anthropic's usage endpoint. It
 * is never logged, written to disk, or sent anywhere else.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = "Claude Code-credentials";

export type OAuthToken = {
	accessToken: string;
	/** Epoch milliseconds, when the credential reports one. */
	expiresAt?: number;
};

export class CredentialError extends Error {}

async function readRaw(): Promise<string> {
	if (process.platform === "darwin") {
		try {
			const { stdout } = await execFileAsync("security", [
				"find-generic-password",
				"-s",
				KEYCHAIN_SERVICE,
				"-w"
			]);
			return stdout;
		} catch (err) {
			// The first read from a new parent process raises a keychain prompt;
			// a denial surfaces here rather than as an empty result.
			throw new CredentialError(
				"could not read the Claude Code credential from the keychain — " +
					"approve the keychain prompt for Stream Deck, or choose Always Allow " +
					`(${err instanceof Error ? err.message.trim() : String(err)})`
			);
		}
	}

	const file = path.join(homedir(), ".claude", ".credentials.json");
	try {
		return await readFile(file, "utf8");
	} catch (err) {
		throw new CredentialError(
			`could not read ${file} (${err instanceof Error ? err.message : String(err)})`
		);
	}
}

export async function readOAuthToken(): Promise<OAuthToken> {
	const raw = await readRaw();

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CredentialError("the stored credential was not valid JSON");
	}

	const oauth = (parsed as { claudeAiOauth?: Record<string, unknown> } | null)?.claudeAiOauth;
	const accessToken = oauth?.["accessToken"];
	if (typeof accessToken !== "string" || accessToken.length === 0) {
		throw new CredentialError("no Claude Code access token found — sign in with `claude` first");
	}

	const expiresAt = oauth?.["expiresAt"];
	return {
		accessToken,
		expiresAt: typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : undefined
	};
}
