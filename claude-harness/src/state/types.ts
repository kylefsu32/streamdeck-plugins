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
	/** The rule "Always allow" would save, e.g. `Bash(gh pr *)`; absent when no single safe rule is on offer. */
	alwaysRule?: string;
	/** AskUserQuestion's questions, one page of options each, answered in order on the deck. */
	choices?: Choice[];
};

/** One multiple-choice question from AskUserQuestion. */
export type Choice = {
	/** The full question; AskUserQuestion's answers are keyed by it. */
	question: string;
	/** A few words for the key, e.g. "Approach". */
	header: string;
	options: Array<{ label: string; description: string }>;
	multiSelect: boolean;
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
	/** "terminal" lets go of the prompt at once so the terminal shows it. */
	behavior: "allow" | "always" | "deny" | "terminal";
	/** For "always": keep the rule for this session only instead of the project's local settings. */
	sessionOnly?: boolean;
	/** For AskUserQuestion: question text → chosen option label. */
	answers?: Record<string, string>;
	at: number;
};

/** Written by the plugin, read by the hook. */
export type HarnessConfig = {
	/**
	 * How long a permission prompt waits for the deck before the terminal shows
	 * it. 0 turns holding off entirely.
	 */
	holdSeconds: number;
	/** The same for Claude's multiple-choice questions, which are rarely urgent. */
	questionHoldSeconds: number;
};

/** The plugin's heartbeat: proof a deck with answer keys is listening. */
export type DeckHeartbeat = {
	at: number;
	/** Allow / Deny keys on the deck: permission prompts can be answered. */
	answerKeys: number;
	/** Option keys on the deck, or a deck that will jump to the answer page: questions can be answered. */
	optionKeys: number;
};

export const DEFAULT_CONFIG: HarnessConfig = { holdSeconds: 15, questionHoldSeconds: 60 };

/** A heartbeat older than this means no deck is listening, so the hook never holds. */
export const HEARTBEAT_FRESH_MS = 12_000;
