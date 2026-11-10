/**
 * Unit tests for the parts with logic in them: the reducer, the settings.json
 * merge and the text fitting. `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { elapsed, moodOf } from "./render/keys";
import { textWidth, wrap } from "./render/svg";
import { reduce, toolLabel } from "./state/reduce";
import { toAgent } from "./state/store";
import { plainRecap } from "./state/transcript";
import { countdown, forecast } from "./usage/forecast";
import { MARKER, withHooks } from "./system/install";
import { decision } from "./hook/decision";
import { justDenied, rememberDeny, ruleText, safeUpdate } from "./state/rules";

const S = "11111111-2222-3333-4444-555555555555";
const ev = (hook_event_name: string, extra: Record<string, unknown> = {}) => ({
	session_id: S,
	cwd: "/Users/kyle/code/streamdeck-plugins",
	hook_event_name,
	...extra
});

test("a turn goes working → asking → working → done", () => {
	let r = reduce(undefined, ev("SessionStart"), 1000)!;
	assert.equal(r.state, "idle");
	assert.equal(r.project, "streamdeck-plugins");

	r = reduce(r, ev("UserPromptSubmit", { prompt: "fix the tests\nplease" }), 2000)!;
	assert.equal(r.state, "working");
	assert.equal(r.prompt, "fix the tests");
	assert.equal(r.turnStartedAt, 2000);

	r = reduce(r, ev("PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } }), 3000)!;
	assert.equal(r.activity, "Bash · npm test");

	r = reduce(r, ev("PermissionRequest", { tool_name: "Bash", tool_input: { command: "git push" }, tool_use_id: "tu1" }), 4000)!;
	assert.equal(r.state, "asking");
	assert.equal(r.question?.kind, "permission");
	assert.equal(r.question?.detail, "git push");

	r = reduce(r, ev("PostToolUse", { tool_name: "Bash" }), 5000)!;
	assert.equal(r.state, "working");
	assert.equal(r.question, null);
	assert.equal(r.turnStartedAt, 2000, "the turn clock keeps running through a question");

	r = reduce(r, ev("Stop"), 6000, "All green.")!;
	assert.equal(r.state, "done");
	assert.equal(r.summary, "All green.");
	assert.equal(r.unread, true);

	assert.equal(reduce(r, ev("SessionEnd"), 7000), null);
});

test("a failed turn is an error with the message as its recap", () => {
	const r = reduce(undefined, ev("StopFailure", { error: "API Error: 529 Overloaded" }), 1)!;
	assert.equal(r.state, "error");
	assert.equal(r.summary, "API Error: 529 Overloaded");
});

test("an idle notification does not hide a finished turn", () => {
	let r = reduce(undefined, ev("Stop"), 1, "Done")!;
	r = reduce(r, ev("Notification", { notification_type: "idle_prompt", message: "waiting" }), 2)!;
	assert.equal(r.state, "done");
});

test("a permission notification without a PermissionRequest still asks", () => {
	const r = reduce(undefined, ev("Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" }), 1)!;
	assert.equal(r.state, "asking");
	assert.equal(r.question?.kind, "notice");
	assert.equal(r.question?.answerable, false);
});

test("AskUserQuestion shows the question", () => {
	const r = reduce(undefined, ev("PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which branch?", options: [{ label: "main" }] }] } }), 1)!;
	assert.equal(r.state, "asking");
	assert.equal(r.question?.detail, "Which branch?");
});

test("tool labels", () => {
	assert.equal(toolLabel("Edit", { file_path: "/a/b/plugin.ts" }), "Edit · plugin.ts");
	assert.equal(toolLabel("mcp__github__create_pull_request", {}), "github · create_pull_request");
	assert.equal(toolLabel("TodoWrite", {}), "Planning");
});

test("reading a finished turn on the deck clears it without touching the record", () => {
	const r = reduce(undefined, ev("Stop"), 50, "Done")!;
	assert.equal(toAgent(r, {}, 60).unseen, true);
	assert.equal(toAgent(r, { [S]: 50 }, 60).unseen, false);
	assert.equal(moodOf(toAgent(r, { [S]: 50 }, 60)), "idle");
});

test("hooks merge keeps the person's own hooks and replaces ours", () => {
	const theirs = { type: "command" as const, command: "say done" };
	const settings = { model: "opus", hooks: { Stop: [{ hooks: [theirs] }] } };
	const cmd = `"/node" "/x/${MARKER}.sdPlugin/bin/hook.mjs"`;

	const once = withHooks(settings, cmd);
	const twice = withHooks(once, cmd);
	assert.deepEqual(twice, once, "installing twice changes nothing");
	assert.equal(once.model, "opus");
	assert.equal(once.hooks!.Stop!.length, 2);
	assert.equal(once.hooks!.Stop![0]!.hooks[0], theirs);
	assert.equal(once.hooks!.PermissionRequest![0]!.hooks[0]!.timeout, 330);

	const moved = withHooks(once, cmd.replace("/node", "/node22"));
	assert.equal(moved.hooks!.Stop!.length, 2, "a new Node path replaces the old entry");

	const removed = withHooks(once, null);
	assert.deepEqual(removed, settings);
	assert.equal(withHooks({}, null).hooks, undefined);
});

test("recaps lose their markdown", () => {
	assert.equal(plainRecap("## Done\n\n- Fixed **login**\n- See `auth.ts` and [PR](http://x)"), "Done Fixed login See auth.ts and PR");
});

test("wrap fits lines and ellipsises the overflow", () => {
	const rows = wrap("one two three four five six seven eight nine ten eleven twelve", 80, 13, 2);
	assert.equal(rows.length, 2);
	assert.ok(rows[1]!.endsWith("…"));
	for (const row of rows) assert.ok(textWidth(row, 13) <= 80, row);
});

test("elapsed reads like the device", () => {
	assert.equal(elapsed(34_000), "0:34");
	assert.equal(elapsed(725_000), "12:05");
	assert.equal(elapsed(3_900_000), "1h 5m");
});

const suggest = (rules: Array<[string, string]>, extra: Record<string, unknown> = {}) => [
	{ type: "addRules", behavior: "allow", destination: "userSettings", rules: rules.map(([toolName, ruleContent]) => ({ toolName, ruleContent })), ...extra }
];

test("always-allow takes only one concrete rule, never for MCP, never to user settings", () => {
	const u = safeUpdate(suggest([["Bash", "gh pr *"]]), "Bash")!;
	assert.equal(ruleText(u), "Bash(gh pr *)");
	assert.equal(u.destination, "localSettings");
	assert.equal(safeUpdate(suggest([["Bash", "gh pr *"]]), "Bash", true)!.destination, "session");
	assert.equal(safeUpdate(suggest([["Bash", "a"], ["Bash", "b"]]), "Bash"), null);
	assert.equal(safeUpdate([{ type: "setMode", mode: "acceptEdits" }], "Edit"), null);
	assert.equal(safeUpdate(suggest([["mcp__x__y", "z"]]), "mcp__x__y"), null);
	assert.equal(safeUpdate(suggest([["Bash", "x".repeat(60)]]), "Bash"), null);
});

test("a deny blocks always for the same rule for 30 s", () => {
	const denies = rememberDeny([], "Bash(gh pr *)", 1000);
	assert.equal(justDenied(denies, "Bash(gh pr *)", 20_000), true);
	assert.equal(justDenied(denies, "Bash(ls *)", 20_000), false);
	assert.equal(justDenied(denies, "Bash(gh pr *)", 32_000), false);
});

test("the permission question carries the rule always would save", () => {
	const r = reduce(undefined, ev("PermissionRequest", { tool_name: "Bash", tool_input: { command: "gh pr list" }, permission_suggestions: suggest([["Bash", "gh pr *"]]) }), 1)!;
	assert.equal(r.question?.alwaysRule, "Bash(gh pr *)");
});

test("decisions: allow, always, deny, terminal, and answers for a question", () => {
	const perm = ev("PermissionRequest", { tool_name: "Bash", permission_suggestions: suggest([["Bash", "gh pr *"]]) });
	const out = (a: Record<string, unknown>, input = perm) =>
		JSON.stringify(decision(input, { questionId: "q", at: 0, behavior: "allow", ...a } as never));
	assert.match(out({}), /"behavior":"allow"/);
	assert.match(out({ behavior: "deny" }), /"behavior":"deny"/);
	assert.match(out({ behavior: "always" }), /"updatedPermissions":\[\{"type":"addRules","behavior":"allow","destination":"localSettings"/);
	assert.equal(decision(perm, { questionId: "q", at: 0, behavior: "terminal" }), undefined);

	const ask = ev("PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which?", header: "H", options: [{ label: "A" }] }] } });
	const d = decision(ask, { questionId: "q", at: 0, behavior: "allow", answers: { "Which?": "A" } }) as {
		hookSpecificOutput: { permissionDecision: string; updatedInput: { answers: Record<string, string>; questions: unknown[] } };
	};
	assert.equal(d.hookSpecificOutput.permissionDecision, "allow");
	assert.deepEqual(d.hookSpecificOutput.updatedInput.answers, { "Which?": "A" });
	assert.equal(d.hookSpecificOutput.updatedInput.questions.length, 1, "the original questions travel with the answers");
});

test("AskUserQuestion options are parsed and survive the PermissionRequest that follows", () => {
	const input = { questions: [{ question: "Which?", header: "Approach", options: [{ label: "A", description: "a" }, { label: "B" }] }] };
	let r = reduce(undefined, ev("PreToolUse", { tool_name: "AskUserQuestion", tool_input: input, tool_use_id: "t" }), 1)!;
	assert.deepEqual(r.question?.choices?.[0]?.options.map((o) => o.label), ["A", "B"]);
	r = reduce(r, ev("PermissionRequest", { tool_name: "AskUserQuestion", tool_input: input, tool_use_id: "t" }), 2)!;
	assert.equal(r.question?.kind, "question");
	assert.equal(r.question?.choices?.length, 1);
});

test("forecast carries the pace to the reset and finds the lock date", () => {
	const day = 86_400_000;
	const now = 10 * day;
	// Four of seven days gone at 61%: 15.25%/day, ~107% by the reset, locks in ~2.6 days.
	const f = forecast("seven_day", { utilization: 61, resetsAt: now + 3 * day }, now)!;
	assert.ok(Math.abs(f.projected - 106.75) < 0.01);
	assert.ok(Math.abs(f.rate - 15.25) < 0.01);
	assert.ok(f.locksAt! > now + 2.5 * day && f.locksAt! < now + 2.6 * day);
	assert.equal(forecast("seven_day", { utilization: 30, resetsAt: now + 3 * day }, now)!.locksAt, null);
	assert.equal(forecast("seven_day", { utilization: 1, resetsAt: now + 6.9 * day }, now), null, "too early to say");
	assert.equal(countdown(now + 156 * 60_000, now), "2h 36m");
});
