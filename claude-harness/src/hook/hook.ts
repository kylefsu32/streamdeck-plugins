/**
 * The Claude Code hook. Claude Code runs this once per hook event with the
 * event as JSON on stdin; it folds the event into that session's state file
 * and exits. It must never break a Claude session, so every failure path ends
 * in a silent exit 0 — the worst a bug here can do is leave a key stale.
 *
 * Two extra modes for setup:
 *   node hook.mjs --install     register this script in ~/.claude/settings.json
 *   node hook.mjs --uninstall   remove it again
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { paths, readJson, writeJsonAtomic } from "../state/paths";
import { reduce, type HookInput } from "../state/reduce";
import { lastAssistantText, plainRecap } from "../state/transcript";
import {
	DEFAULT_CONFIG,
	HEARTBEAT_FRESH_MS,
	type AgentRecord,
	type Answer,
	type DeckHeartbeat,
	type HarnessConfig
} from "../state/types";
import { applyHooks, hookCommand } from "../system/install";
import { decision } from "./decision";

const STALE_SESSION_MS = 24 * 3_600_000;
const POLL_MS = 150;

async function main(): Promise<void> {
	const arg = process.argv[2];
	if (arg === "--install" || arg === "--uninstall") {
		const self = fileURLToPath(import.meta.url);
		const out = applyHooks(arg === "--install" ? hookCommand(process.execPath, self) : null);
		console.log(`${out.result}: ${out.file}${out.error ? ` (${out.error})` : ""}`);
		process.exitCode = out.result === "failed" ? 1 : 0;
		return;
	}

	const input = JSON.parse(await readStdin()) as HookInput;
	if (!input.session_id) return;
	await handle(input);
}

export async function handle(input: HookInput): Promise<void> {
	const now = Date.now();
	const file = paths.session(input.session_id!);
	const prev = readJson<AgentRecord>(file);

	let summary = "";
	if (input.hook_event_name === "Stop") {
		summary = plainRecap(input.last_assistant_message || lastAssistantText(input.transcript_path));
	}
	if (input.hook_event_name === "SessionStart") pruneStale(now);

	const next = reduce(prev, input, now, summary);
	if (!next) {
		rmSync(file, { force: true });
		return;
	}

	const held = heldKind(input);
	if (held && next.question) {
		const hold = holdMs(held, now);
		if (hold > 0) {
			next.question.answerable = true;
			next.question.holdUntil = now + hold;
			writeJsonAtomic(file, next);
			const answer = await waitForAnswer(next.question.id, now + hold);
			settleHeldQuestion(file, next.question.id, answer);
			const out = answer && decision(input, answer);
			if (out) process.stdout.write(JSON.stringify(out));
			return;
		}
	}
	writeJsonAtomic(file, next);
}

/**
 * Which events may wait for the deck. A permission prompt waits in
 * PermissionRequest. Claude's multiple-choice questions wait in PreToolUse,
 * before Claude Code draws its own picker, and are answered by handing the
 * tool its `answers` up front — the same field an Agent SDK host fills in.
 */
function heldKind(input: HookInput): "permission" | "question" | undefined {
	if (input.hook_event_name === "PermissionRequest" && input.tool_name !== "AskUserQuestion") return "permission";
	if (input.hook_event_name === "PreToolUse" && input.tool_name === "AskUserQuestion") return "question";
	return undefined;
}

/** How long to hold: only while a deck that can answer this kind of prompt is alive. */
function holdMs(kind: "permission" | "question", now: number): number {
	const config = { ...DEFAULT_CONFIG, ...(readJson<HarnessConfig>(paths.config()) ?? {}) };
	const beat = readJson<DeckHeartbeat>(paths.heartbeat());
	if (!beat || now - beat.at > HEARTBEAT_FRESH_MS) return 0;
	const keys = kind === "permission" ? beat.answerKeys : beat.optionKeys;
	if (!(keys >= 1)) return 0;
	const seconds = kind === "permission" ? config.holdSeconds : config.questionHoldSeconds;
	return Math.max(0, Math.min(300, Number(seconds) || 0)) * 1000;
}

async function waitForAnswer(questionId: string, until: number): Promise<Answer | undefined> {
	const file = paths.answer(questionId);
	while (Date.now() < until) {
		const answer = readJson<Answer>(file);
		if (answer && answer.questionId === questionId) {
			rmSync(file, { force: true });
			return answer;
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	return undefined;
}

/**
 * Re-reads the record (other hooks may have written meanwhile) and moves the
 * question on: answered means back to work, timed out means the prompt now
 * sits in the terminal and the deck can no longer answer it.
 */
function settleHeldQuestion(file: string, questionId: string, answer: Answer | undefined): void {
	const r = readJson<AgentRecord>(file);
	if (!r || r.question?.id !== questionId) return;
	const now = Date.now();
	if (answer && answer.behavior !== "terminal") {
		r.state = "working";
		r.activity =
			r.question.kind === "question" ? "Thinking" : answer.behavior === "deny" ? "Denied" : `Allowed · ${r.question.tool}`;
		r.question = null;
	} else {
		r.question = { ...r.question, answerable: false, holdUntil: undefined };
	}
	r.updatedAt = now;
	writeJsonAtomic(file, r);
}

/** A crashed or killed session never sends SessionEnd. Sweep its leftovers now and then. */
function pruneStale(now: number): void {
	for (const dir of [paths.sessions(), paths.answers()]) {
		let names: string[] = [];
		try {
			names = readdirSync(dir);
		} catch {
			continue;
		}
		for (const name of names) {
			const f = path.join(dir, name);
			try {
				if (now - statSync(f).mtimeMs > STALE_SESSION_MS) rmSync(f, { force: true });
			} catch {
				/* raced with another hook */
			}
		}
	}
}

function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (c) => (data += c));
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", () => resolve(data));
	});
}

main().catch(() => {
	process.exitCode = 0;
});
