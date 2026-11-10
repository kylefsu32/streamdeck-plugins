/**
 * Renders every key face with made-up sessions to dist/preview.html, so the
 * art can be checked in a browser without a Stream Deck. `npm run preview`.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { agentKey, alwaysKey, answerKey, emptyAgentKey, inboxKey, optionKey, overviewKey, questionKey, terminalKey } from "./render/keys";
import type { Agent } from "./state/store";

const now = Date.now();
const base: Agent = {
	id: "a",
	engine: "claude",
	project: "streamdeck-plugins",
	cwd: "/Users/kyle/code/streamdeck-plugins",
	state: "idle",
	activity: "",
	prompt: "",
	summary: "",
	question: null,
	unread: false,
	startedAt: now - 3_600_000,
	turnStartedAt: now - 94_000,
	turnEndedAt: now - 600_000,
	updatedAt: now - 60_000,
	unseen: false,
	asleep: false
};
const agent = (p: Partial<Agent>): Agent => ({ ...base, ...p });

const working = agent({ id: "w", state: "working", activity: "Bash · npm test -- --run", updatedAt: now });
const asking = agent({
	id: "q",
	project: "claude-gauges",
	state: "asking",
	question: {
		id: "q1",
		kind: "permission",
		tool: "Bash",
		detail: "git push -u origin claude/project-thread-5adc9a",
		at: now - 4000,
		answerable: true,
		holdUntil: now + 11_000
	}
});
const choices = [
	{
		question: "Retries time out under load. Which fix should I make?",
		header: "Approach",
		multiSelect: false,
		options: [
			{ label: "Add jitter", description: "" },
			{ label: "Token bucket", description: "" },
			{ label: "Leave it for now", description: "" },
			{ label: "Rewrite the client with backoff", description: "" }
		]
	},
	{ question: "Ship it today?", header: "Release", multiSelect: false, options: [{ label: "Yes", description: "" }, { label: "No", description: "" }] }
];
const choosing = agent({
	id: "c",
	project: "api",
	state: "asking",
	question: { id: "q2", kind: "question", tool: "Approach", detail: choices[0]!.question, at: now, answerable: true, holdUntil: now + 90_000, choices }
});
const done = agent({
	id: "d",
	project: "openharness",
	state: "done",
	unread: true,
	unseen: true,
	summary:
		"Fixed the login redirect loop. The session cookie was set on the wrong path, so every refresh bounced back to /login. Added a regression test and all 312 tests pass.",
	turnEndedAt: now - 120_000
});
const error = agent({ id: "e", project: "api", state: "error", unread: true, unseen: true, summary: "API Error: 529 Overloaded" });
const idle = agent({ id: "i", project: "dotfiles" });
const asleep = agent({ id: "s", project: "notes", asleep: true, updatedAt: now - 7_200_000 });
const all = [working, asking, done, error, idle, asleep];

const tiles: Array<[string, string]> = [
	["Agent · working", agentKey(working, now, 3)],
	["Agent · working (tick)", agentKey(working, now, 4)],
	["Agent · needs you", agentKey(asking, now, 0)],
	["Agent · done", agentKey(done, now, 0)],
	["Agent · error", agentKey(error, now, 0)],
	["Agent · idle", agentKey(idle, now, 0)],
	["Agent · asleep", agentKey(asleep, now, 0)],
	["Agent · empty slot", emptyAgentKey("Slot 4")],
	["Overview", overviewKey(all, 0)],
	["Overview · none", overviewKey([], 0)],
	["Inbox", inboxKey(done, 2)],
	["Inbox · empty", inboxKey(undefined, 0)],
	["Needs you · on deck", questionKey({ agent: asking, question: asking.question! }, 0, 2, now, 0)],
	[
		"Needs you · terminal",
		questionKey({ agent: asking, question: { ...asking.question!, answerable: false, holdUntil: undefined } }, 0, 1, now, 0)
	],
	["Needs you · clear", questionKey(undefined, 0, 0, now, 0)],
	["Allow · live", answerKey("allow", true)],
	["Deny · live", answerKey("deny", true)],
	["Allow · idle", answerKey("allow", false)],
	["Allow · sent", answerKey("allow", false, "sent")],
	["Always · rule", alwaysKey("Bash(gh pr *)", true)],
	["Always · long rule", alwaysKey("WebFetch(domain:docs.example.com)", true)],
	["Always · just denied", alwaysKey("Bash(gh pr *)", true, "just denied")],
	["Always · no rule", alwaysKey(undefined, true, "n/a")],
	["Needs you · question 1/2", questionKey({ agent: choosing, question: choosing.question! }, 0, 1, now, 0)],
	["Option 1", optionKey(1, "Add jitter", true)],
	["Option 3", optionKey(3, "Leave it for now", true)],
	["Option 4 · long", optionKey(4, "Rewrite the client with backoff", true)],
	["Option · none", optionKey(4, undefined, false)],
	["Use terminal", terminalKey(true)]
];

mkdirSync("dist/preview", { recursive: true });
const cells = tiles
	.map(([label, svg], i) => {
		writeFileSync(`dist/preview/${String(i).padStart(2, "0")}.svg`, svg);
		return `<figure><img src="preview/${String(i).padStart(2, "0")}.svg" width="144" height="144"><figcaption>${label}</figcaption></figure>`;
	})
	.join("\n");
writeFileSync(
	"dist/preview.html",
	`<!doctype html><meta charset="utf-8"><title>Claude Harness keys</title>
<style>body{background:#0b0b0d;color:#bbb;font:13px system-ui;display:flex;flex-wrap:wrap;gap:18px;padding:24px}
figure{margin:0;text-align:center}img{border-radius:18px;display:block;margin-bottom:6px}</style>
${cells}`
);
console.log(`wrote dist/preview.html (${tiles.length} keys)`);
