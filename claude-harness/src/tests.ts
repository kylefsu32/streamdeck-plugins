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
import { MARKER, withHooks } from "./system/install";

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
	const r = reduce(undefined, ev("PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which branch?" }] } }), 1)!;
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
