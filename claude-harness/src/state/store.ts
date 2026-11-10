import { mkdirSync, readdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

import { claudeHome, paths, readJson, writeJsonAtomic } from "./paths";
import { justDenied, rememberDeny, type RecentDeny } from "./rules";
import { DEFAULT_CONFIG, type AgentRecord, type Answer, type DeckHeartbeat, type HarnessConfig, type Question } from "./types";

/** An agent as the keys draw it: the hook's record plus what only the deck knows. */
export type Agent = AgentRecord & {
	/** Unread and not yet acknowledged on this deck. */
	unseen: boolean;
	/** Idle for a long time — the harness device dims these. */
	asleep: boolean;
};

const ASLEEP_AFTER_MS = 30 * 60_000;
const HIDE_AFTER_MS = 12 * 3_600_000;
const RESCAN_MS = 2_000;
const HEARTBEAT_MS = 4_000;

type Listener = () => void;

/**
 * The plugin's view of every Claude session on this machine.
 *
 * It reads the hook's files and never writes them: what has been read on the
 * deck is kept in a file of its own (acks), so a key press can never race a
 * hook that is writing the same session at that moment.
 */
export class HarnessStore {
	#agents: Agent[] = [];
	#acks: Record<string, number> = {};
	#listeners = new Set<Listener>();
	#watcher: FSWatcher | undefined;
	#timers: NodeJS.Timeout[] = [];
	#debounce: NodeJS.Timeout | undefined;
	#signature = "";
	#questionCursor = 0;
	#answerKeys = new Set<string>();
	#optionKeys = new Set<string>();
	#takeover = false;
	/** Options picked so far for a multi-question AskUserQuestion, by question id. */
	#picks = new Map<string, string[]>();
	#denies: RecentDeny[] = [];
	#config: HarnessConfig = { ...DEFAULT_CONFIG };

	start(): void {
		if (this.#timers.length) return;
		mkdirSync(paths.sessions(), { recursive: true });
		this.#acks = readJson<Record<string, number>>(this.#acksFile()) ?? {};
		this.#config = { ...DEFAULT_CONFIG, ...(readJson<HarnessConfig>(paths.config()) ?? {}) };
		this.#scan();
		try {
			// fs.watch is the fast path; on some filesystems it drops events, so the
			// rescan below is what guarantees the deck catches up.
			this.#watcher = watch(paths.sessions(), () => this.#scheduleScan());
		} catch {
			this.#watcher = undefined;
		}
		this.#timers.push(setInterval(() => this.#scan(), RESCAN_MS));
		this.#timers.push(setInterval(() => this.#beat(), HEARTBEAT_MS));
		this.#beat();
	}

	stop(): void {
		this.#watcher?.close();
		this.#timers.forEach(clearInterval);
		this.#timers = [];
	}

	subscribe(fn: Listener): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	get agents(): readonly Agent[] {
		return this.#agents;
	}

	agentAt(slot: number): Agent | undefined {
		return this.#agents[slot];
	}

	agentByProject(name: string): Agent | undefined {
		const want = name.trim().toLowerCase();
		const matches = this.#agents.filter((a) => a.project.toLowerCase() === want);
		// Two sessions in one folder: show the one that most needs looking at.
		return matches.sort((a, b) => urgency(b) - urgency(a) || b.updatedAt - a.updatedAt)[0];
	}

	/** Every open question, oldest first — the order a person should get through them. */
	get questions(): Array<{ agent: Agent; question: Question }> {
		return this.#agents
			.filter((a) => a.state === "asking" && a.question)
			.map((a) => ({ agent: a, question: a.question! }))
			.sort((x, y) => x.question.at - y.question.at);
	}

	/** The question the Needs-you key shows and Allow / Deny answer. */
	get currentQuestion(): { agent: Agent; question: Question } | undefined {
		const qs = this.questions;
		if (!qs.length) return undefined;
		return qs[this.#questionCursor % qs.length];
	}

	nextQuestion(): void {
		this.#questionCursor = (this.#questionCursor + 1) % Math.max(1, this.questions.length);
		this.#emit();
	}

	/** Newest unread recap first, like the device's notification drawer. */
	get inbox(): Agent[] {
		return this.#agents.filter((a) => a.unseen).sort((a, b) => b.turnEndedAt - a.turnEndedAt);
	}

	markRead(agent: Agent): void {
		this.#acks[agent.id] = agent.turnEndedAt;
		this.#saveAcks();
		this.#rebuild(this.#records());
	}

	markAllRead(): void {
		for (const a of this.#agents) if (a.unseen) this.#acks[a.id] = a.turnEndedAt;
		this.#saveAcks();
		this.#rebuild(this.#records());
	}

	/** Leaves an answer for the hook that is holding this prompt. */
	answer(
		question: Question,
		behavior: Answer["behavior"],
		extra: { answers?: Record<string, string>; sessionOnly?: boolean } = {}
	): boolean {
		const now = Date.now();
		if (!question.answerable || (question.holdUntil && now > question.holdUntil)) return false;
		if (behavior === "always" && (!question.alwaysRule || this.alwaysBlocked(question))) return false;
		if (behavior === "deny") this.#denies = rememberDeny(this.#denies, question.alwaysRule, now);
		const answer: Answer = { questionId: question.id, behavior, ...extra, at: now };
		writeJsonAtomic(paths.answer(question.id), answer);
		this.#picks.delete(question.id);
		return true;
	}

	/** Which of AskUserQuestion's questions the deck is on (0-based). */
	step(question: Question): number {
		return this.#picks.get(question.id)?.length ?? 0;
	}

	/**
	 * Picks option `index` for the question on screen. The last pick sends the
	 * whole set of answers; earlier ones move the deck to the next question.
	 */
	pick(question: Question, index: number): "sent" | "next" | "invalid" {
		const choices = question.choices ?? [];
		const picks = [...(this.#picks.get(question.id) ?? [])];
		const option = choices[picks.length]?.options[index];
		if (!option || !question.answerable) return "invalid";
		picks.push(option.label);
		if (picks.length < choices.length) {
			this.#picks.set(question.id, picks);
			this.#emit();
			return "next";
		}
		const answers = Object.fromEntries(choices.map((c, i) => [c.question, picks[i]!]));
		return this.answer(question, "allow", { answers }) ? "sent" : "invalid";
	}

	/** Always is refused for 30 s after denying a call its rule would re-permit (Claude retries at once). */
	alwaysBlocked(question: Question): boolean {
		return justDenied(this.#denies, question.alwaysRule, Date.now());
	}

	/** Answer keys on the deck register here; while any exist the hook may hold prompts. */
	setAnswerKey(id: string, present: boolean): void {
		if (present) this.#answerKeys.add(id);
		else this.#answerKeys.delete(id);
		this.#beat();
	}

	/** Option keys, likewise, for Claude's multiple-choice questions. */
	setOptionKey(id: string, present: boolean): void {
		if (present) this.#optionKeys.add(id);
		else this.#optionKeys.delete(id);
		this.#beat();
	}

	/** True when a deck will jump to the answer page by itself, so questions are worth holding. */
	setTakeover(on: boolean): void {
		this.#takeover = on;
		this.#beat();
	}

	get config(): HarnessConfig {
		return this.#config;
	}

	setConfig(config: Partial<HarnessConfig>): void {
		this.#config = { ...this.#config, ...config };
		writeJsonAtomic(paths.config(), this.#config);
	}

	#beat(): void {
		const beat: DeckHeartbeat = {
			at: Date.now(),
			answerKeys: this.#answerKeys.size,
			optionKeys: this.#optionKeys.size + (this.#takeover ? 1 : 0)
		};
		try {
			writeJsonAtomic(paths.heartbeat(), beat);
		} catch {
			/* read-only home: holding just stays off */
		}
	}

	#scheduleScan(): void {
		clearTimeout(this.#debounce);
		this.#debounce = setTimeout(() => this.#scan(), 60);
	}

	#scan(): void {
		this.#rebuild(this.#records());
	}

	#records(): AgentRecord[] {
		let names: string[] = [];
		try {
			names = readdirSync(paths.sessions()).filter((n) => n.endsWith(".json"));
		} catch {
			return [];
		}
		return names
			.map((n) => readJson<AgentRecord>(path.join(paths.sessions(), n)))
			.filter((r): r is AgentRecord => !!r && typeof r.id === "string");
	}

	#rebuild(records: AgentRecord[]): void {
		const now = Date.now();
		const dead = deadSessions();
		const agents = records
			.filter((r) => !dead.has(r.id))
			.filter((r) => now - r.updatedAt < HIDE_AFTER_MS || r.state === "asking")
			.map((r) => toAgent(r, this.#acks, now))
			.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));

		const signature = JSON.stringify(agents);
		if (signature === this.#signature) return;
		this.#signature = signature;
		this.#agents = agents;
		this.#emit();
	}

	#emit(): void {
		for (const fn of this.#listeners) {
			try {
				fn();
			} catch {
				/* one bad key must not stop the others repainting */
			}
		}
	}

	#acksFile(): string {
		return path.join(path.dirname(paths.sessions()), "acks.json");
	}

	#saveAcks(): void {
		// Drop acks for sessions that no longer exist so the file stays small.
		const live = new Set(this.#records().map((r) => r.id));
		for (const id of Object.keys(this.#acks)) if (!live.has(id)) delete this.#acks[id];
		writeJsonAtomic(this.#acksFile(), this.#acks);
	}
}

/**
 * Sessions whose Claude process is gone. Claude Code keeps a small file per
 * running process in ~/.claude/sessions/<pid>.json with its sessionId (seen
 * by tapparello/agent-vitals), so a session killed without SessionEnd can be
 * dropped at once instead of after the 12-hour timeout. A session with no
 * such file is left alone: older versions and the IDE extensions may not
 * write one.
 */
function deadSessions(): Set<string> {
	const dead = new Set<string>();
	const live = new Set<string>();
	const dir = path.join(claudeHome(), "sessions");
	let names: string[] = [];
	try {
		names = readdirSync(dir).filter((n) => n.endsWith(".json"));
	} catch {
		return dead;
	}
	for (const name of names) {
		const s = readJson<{ sessionId?: string; pid?: number }>(path.join(dir, name));
		const pid = Number(s?.pid ?? Number.parseInt(name, 10));
		if (!s?.sessionId || !Number.isInteger(pid) || pid <= 0) continue;
		if (processAlive(pid)) live.add(s.sessionId);
		else dead.add(s.sessionId);
	}
	// A resumed session can leave an old pid file behind next to its live one.
	for (const id of live) dead.delete(id);
	return dead;
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM: it exists, it just isn't ours to signal.
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

export function toAgent(r: AgentRecord, acks: Record<string, number>, now: number): Agent {
	const unseen = r.unread && acks[r.id] !== r.turnEndedAt;
	const quiet = r.state === "idle" || ((r.state === "done" || r.state === "error") && !unseen);
	return { ...r, unseen, asleep: quiet && now - r.updatedAt > ASLEEP_AFTER_MS };
}

/** Higher is more urgent: asking beats error beats an unread finish beats working. */
export function urgency(a: Agent): number {
	if (a.state === "asking") return 5;
	if (a.state === "error" && a.unseen) return 4;
	if (a.state === "done" && a.unseen) return 3;
	if (a.state === "working") return 2;
	return a.asleep ? 0 : 1;
}

export const store = new HarnessStore();
