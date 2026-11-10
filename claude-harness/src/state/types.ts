/**
 * What one Claude Code session looks like on the deck.
 *
 * The vocabulary is the harness device's: an agent is idle, working, asking
 * (it needs a person), done (finished a turn nobody has looked at yet) or in
 * error (the turn died on an API failure). The hook writes these records and
 * the plugin only reads them, so this file is the whole contract between the
 * two processes.
 */

export type AgentState = "idle" | "working" | "asking" | "done" | "error";

export type QuestionKind = "permission" | "question" | "notice";

export type Question = {
	/** Unique per prompt; the answer file is named after it. */
	id: string;
	kind: QuestionKind;
	/** The tool asking, e.g. "Bash". Empty for a plain notice. */
	tool: string;
	/** The one line a person needs to decide: the command, the file, the question. */
	detail: string;
	at: number;
	/**
	 * True while the hook is holding the prompt for an answer from the deck.
	 * Allow and Deny only light up for these; any other prompt has to be
	 * answered in the terminal.
	 */
	answerable: boolean;
	/** When the hook stops holding and hands the prompt back to the terminal. */
	holdUntil?: number;
};

export type AgentRecord = {
	/** Claude Code's session_id. */
	id: string;
	engine: "claude";
	/** Basename of the working directory — what the harness device calls the pane. */
	project: string;
	cwd: string;
	state: AgentState;
	/** What the turn is doing right now: "Thinking", "Bash · npm test", "Edit · plugin.ts". */
	activity: string;
	/** First line of the prompt that started the current turn. */
	prompt: string;
	/** Recap of the last finished turn, or the error that ended it. */
	summary: string;
	question: Question | null;
	/** A finished turn or an error that nobody has acknowledged on the deck. */
	unread: boolean;
	startedAt: number;
	turnStartedAt: number;
	turnEndedAt: number;
	updatedAt: number;
};

/** An answer the deck leaves for a held permission prompt. */
export type Answer = {
	questionId: string;
	behavior: "allow" | "deny";
	at: number;
};

/** Written by the plugin, read by the hook. */
export type HarnessConfig = {
	/**
	 * How long a permission prompt waits for the deck before the terminal shows
	 * it. 0 turns holding off entirely.
	 */
	holdSeconds: number;
};

/** The plugin's heartbeat: proof a deck with answer keys is listening. */
export type DeckHeartbeat = {
	at: number;
	answerKeys: number;
};

export const DEFAULT_CONFIG: HarnessConfig = { holdSeconds: 15 };

/** A heartbeat older than this means no deck is listening, so the hook never holds. */
export const HEARTBEAT_FRESH_MS = 12_000;
