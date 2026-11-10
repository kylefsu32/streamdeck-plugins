import path from "node:path";

import { ruleText, safeUpdate } from "./rules";
import type { AgentRecord, Choice, Question } from "./types";

/**
 * The fields of a Claude Code hook payload this plugin reads. Every hook gets
 * session_id, cwd and hook_event_name; the rest depend on the event.
 */
export type HookInput = {
	session_id?: string;
	cwd?: string;
	hook_event_name?: string;
	transcript_path?: string;
	prompt?: string;
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	tool_use_id?: string;
	permission_suggestions?: unknown;
	message?: string;
	notification_type?: string;
	last_assistant_message?: string;
	error?: string;
	error_type?: string;
	reason?: string;
};

export function blankRecord(input: HookInput, now: number): AgentRecord {
	const cwd = input.cwd ?? "";
	return {
		id: input.session_id ?? "unknown",
		engine: "claude",
		project: projectName(cwd),
		cwd,
		state: "idle",
		activity: "",
		prompt: "",
		summary: "",
		question: null,
		unread: false,
		startedAt: now,
		turnStartedAt: 0,
		turnEndedAt: 0,
		updatedAt: now
	};
}

export function projectName(cwd: string): string {
	const base = path.basename(cwd.replace(/[\\/]+$/, ""));
	return base || "claude";
}

/**
 * Folds one hook event into a session's record. Returns null when the session
 * is over and its record should go. `summary` is the recap the caller dug out
 * of the transcript for a Stop event; it is passed in so this stays pure.
 */
export function reduce(
	prev: AgentRecord | undefined,
	input: HookInput,
	now: number,
	summary = ""
): AgentRecord | null {
	const event = input.hook_event_name ?? "";
	if (event === "SessionEnd") return null;

	const r: AgentRecord = { ...(prev ?? blankRecord(input, now)), updatedAt: now };
	if (input.cwd && input.cwd !== r.cwd) {
		r.cwd = input.cwd;
		r.project = projectName(input.cwd);
	}

	switch (event) {
		case "SessionStart":
			// A resume or /clear keeps the session id; only a brand-new one starts idle.
			if (!prev) r.state = "idle";
			break;

		case "UserPromptSubmit":
			r.state = "working";
			r.activity = "Thinking";
			r.prompt = firstLine(input.prompt ?? "", 120);
			r.summary = "";
			r.question = null;
			r.unread = false;
			r.turnStartedAt = now;
			r.turnEndedAt = 0;
			break;

		case "PreToolUse": {
			if (input.tool_name === "AskUserQuestion") {
				r.state = "asking";
				r.question = askUserQuestion(input, now);
				break;
			}
			startTurnIfNeeded(r, now);
			r.state = "working";
			r.activity = toolLabel(input.tool_name ?? "", input.tool_input ?? {});
			break;
		}

		case "PostToolUse":
		case "PostToolUseFailure":
			// The tool ran, so whatever was asked has been answered.
			startTurnIfNeeded(r, now);
			r.state = "working";
			r.question = null;
			r.activity = "Thinking";
			break;

		case "PermissionRequest":
			// AskUserQuestion was already put up by PreToolUse; keep that one.
			if (input.tool_name === "AskUserQuestion" && r.question?.kind === "question") break;
			r.state = "asking";
			r.question = permissionQuestion(input, now);
			break;

		case "Notification": {
			const type = input.notification_type ?? "";
			if (type === "permission_prompt" || type === "elicitation_dialog") {
				// PermissionRequest normally got here first with more detail; keep it.
				if (r.state !== "asking" || !r.question) {
					r.state = "asking";
					r.question = {
						id: `${r.id}-${now}`,
						kind: "notice",
						tool: "",
						detail: firstLine(input.message ?? "Needs your answer", 140),
						at: now,
						answerable: false
					};
				}
			} else if (type === "idle_prompt") {
				// Claude is waiting for the next prompt. A finished turn stays "done"
				// until someone reads it; anything else settles to idle.
				if (r.state === "working" || r.state === "asking") r.state = "idle";
				r.question = null;
			}
			break;
		}

		case "Stop":
			r.state = "done";
			r.activity = "";
			r.question = null;
			r.summary = summary || firstLine(input.last_assistant_message ?? "", 400) || "Finished";
			r.unread = true;
			r.turnEndedAt = now;
			break;

		case "StopFailure":
			r.state = "error";
			r.activity = "";
			r.question = null;
			r.summary = firstLine(input.error ?? input.message ?? input.error_type ?? "The turn failed", 200);
			r.unread = true;
			r.turnEndedAt = now;
			break;

		default:
			break;
	}
	return r;
}

function startTurnIfNeeded(r: AgentRecord, now: number): void {
	if (r.state !== "working" && r.state !== "asking") {
		r.turnStartedAt = now;
		r.turnEndedAt = 0;
		r.unread = false;
		r.summary = "";
	}
}

function permissionQuestion(input: HookInput, now: number): Question {
	const tool = input.tool_name ?? "";
	const always = safeUpdate(input.permission_suggestions, tool);
	return {
		alwaysRule: always ? ruleText(always) : undefined,
		id: `${safeId(input.session_id)}-${input.tool_use_id ? safeId(input.tool_use_id) : now}`,
		kind: "permission",
		tool: toolName(tool),
		detail: toolDetail(tool, input.tool_input ?? {}) || toolName(tool),
		at: now,
		answerable: false
	};
}

function askUserQuestion(input: HookInput, now: number): Question {
	const choices = parseChoices(input.tool_input);
	const text = choices[0]?.question ?? "Claude has a question";
	return {
		id: `${safeId(input.session_id)}-${input.tool_use_id ? safeId(input.tool_use_id) : now}`,
		kind: "question",
		tool: choices[0]?.header || "Question",
		detail: firstLine(text, 140),
		at: now,
		answerable: false,
		choices
	};
}

/** AskUserQuestion's input, defensively: 1–4 questions of 2–4 options each. */
export function parseChoices(toolInput: Record<string, unknown> | undefined): Choice[] {
	const raw = Array.isArray(toolInput?.questions) ? (toolInput!.questions as unknown[]) : [];
	return raw
		.map((q) => q as { question?: unknown; header?: unknown; options?: unknown; multiSelect?: unknown })
		.filter((q) => typeof q?.question === "string")
		.map((q) => ({
			question: q.question as string,
			header: typeof q.header === "string" ? q.header : "",
			multiSelect: q.multiSelect === true,
			options: (Array.isArray(q.options) ? q.options : [])
				.map((o) => o as { label?: unknown; description?: unknown })
				.filter((o) => typeof o?.label === "string")
				.map((o) => ({ label: o.label as string, description: typeof o.description === "string" ? o.description : "" }))
		}))
		.filter((q) => q.options.length > 0);
}

function safeId(s: string | undefined): string {
	return String(s ?? "x").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "x";
}

/** "mcp__github__create_pull_request" reads better as "github · create_pull_request". */
export function toolName(tool: string): string {
	const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
	if (mcp) return `${mcp[1]} · ${mcp[2]}`;
	return tool;
}

/** The one argument that tells you what a tool call is about. */
export function toolDetail(tool: string, input: Record<string, unknown>): string {
	const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
	switch (tool) {
		case "Bash":
			return firstLine(str("command"), 140);
		case "Read":
		case "Edit":
		case "MultiEdit":
		case "Write":
		case "NotebookEdit":
			return path.basename(str("file_path") || str("notebook_path"));
		case "Grep":
		case "Glob":
			return firstLine(str("pattern"), 80);
		case "WebFetch":
			return hostOf(str("url"));
		case "WebSearch":
			return firstLine(str("query"), 80);
		case "Task":
		case "Agent":
			return firstLine(str("description") || str("subagent_type"), 80);
		default:
			return "";
	}
}

/** What the working line says: the harness device shows the running tool, not a spinner verb. */
export function toolLabel(tool: string, input: Record<string, unknown>): string {
	if (tool === "TodoWrite" || tool === "TaskCreate" || tool === "TaskUpdate") return "Planning";
	const name = toolName(tool);
	const detail = toolDetail(tool, input);
	return detail ? `${name} · ${detail}` : name || "Working";
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return firstLine(url, 60);
	}
}

export function firstLine(text: string, max: number): string {
	const line =
		String(text)
			.split(/\r?\n/)
			.map((l) => l.trim())
			.find((l) => l.length > 0) ?? "";
	return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
