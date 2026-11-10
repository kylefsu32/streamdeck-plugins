import type { JsonObject } from "@elgato/utils";
import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { agentKey, answerKey, emptyAgentKey, inboxKey, overviewKey, questionKey } from "../render/keys";
import { store } from "../state/store";
import { clock, StoreAction } from "./base";

type AgentSettings = JsonObject & {
	/** 1-based position in session start order. Ignored when a project is pinned. */
	slot?: number | string;
	/** Follow the session in this folder (its basename), wherever it sits in the order. */
	project?: string;
};

function slotOf(s: AgentSettings): number {
	const n = Math.floor(Number(s.slot));
	return Number.isFinite(n) && n >= 1 ? n : 1;
}

function agentFor(s: AgentSettings) {
	return s.project?.trim() ? store.agentByProject(s.project) : store.agentAt(slotOf(s) - 1);
}

/**
 * Agent — one Claude session, the way the harness device's Focus face shows a
 * pane. Press it to mark a finished turn as read.
 */
@action({ UUID: "com.kylefsu.claude-harness.agent" })
export class AgentKey extends StoreAction<AgentSettings> {
	protected render(s: AgentSettings): string {
		const a = agentFor(s);
		if (!a) return emptyAgentKey(s.project?.trim() || `Slot ${slotOf(s)}`);
		return agentKey(a, Date.now(), clock.tick);
	}

	override onKeyDown(ev: KeyDownEvent<AgentSettings>): void {
		const a = agentFor(ev.payload.settings ?? {});
		if (a?.unseen) store.markRead(a);
		else void ev.action.showAlert();
	}
}

/** Overview — counts across every session. Press clears every finished turn. */
@action({ UUID: "com.kylefsu.claude-harness.overview" })
export class OverviewKey extends StoreAction {
	protected render(): string {
		return overviewKey(store.agents, clock.tick);
	}

	override onKeyDown(): void {
		store.markAllRead();
	}
}

/** Inbox — the newest unread recap. Press reads it and shows the next. */
@action({ UUID: "com.kylefsu.claude-harness.inbox" })
export class InboxKey extends StoreAction {
	protected render(): string {
		const inbox = store.inbox;
		return inboxKey(inbox[0], inbox.length);
	}

	override onKeyDown(ev: KeyDownEvent): void {
		const first = store.inbox[0];
		if (first) store.markRead(first);
		else void ev.action.showAlert();
	}
}

/**
 * Needs you — the question waiting longest. Press steps to the next one when
 * several sessions are waiting; Allow and Deny answer whichever is shown.
 */
@action({ UUID: "com.kylefsu.claude-harness.question" })
export class QuestionKey extends StoreAction {
	protected render(): string {
		const qs = store.questions;
		const current = store.currentQuestion;
		const index = current ? qs.findIndex((q) => q.question.id === current.question.id) : 0;
		return questionKey(current, Math.max(0, index), qs.length, Date.now(), clock.tick);
	}

	override onKeyDown(ev: KeyDownEvent): void {
		if (store.questions.length > 1) store.nextQuestion();
		else if (!store.questions.length) void ev.action.showAlert();
	}
}

/**
 * Allow / Deny — answer the prompt on the Needs-you key. Only prompts the hook
 * is holding can be answered from here; while any of these keys is on the
 * deck, the hook holds new prompts for the configured number of seconds.
 */
abstract class AnswerKey extends StoreAction {
	protected abstract readonly behavior: "allow" | "deny";
	readonly #flash = new Map<string, { kind: "sent" | "late"; until: number }>();

	protected override appeared(id: string): void {
		store.setAnswerKey(`${this.behavior}:${id}`, true);
	}

	protected override disappeared(id: string): void {
		store.setAnswerKey(`${this.behavior}:${id}`, false);
	}

	protected render(_s: JsonObject, id: string): string {
		const flash = this.#flash.get(id);
		if (flash && flash.until > Date.now()) return answerKey(this.behavior, false, flash.kind);
		const q = store.currentQuestion?.question;
		const live = !!q?.answerable && (!q.holdUntil || q.holdUntil > Date.now());
		return answerKey(this.behavior, live);
	}

	override onKeyDown(ev: KeyDownEvent): void {
		const q = store.currentQuestion?.question;
		if (!q) {
			void ev.action.showAlert();
			return;
		}
		const ok = store.answer(q, this.behavior);
		this.#flash.set(ev.action.id, { kind: ok ? "sent" : "late", until: Date.now() + 1500 });
		if (!ok) void ev.action.showAlert();
		this.paint(ev.action.id);
	}
}

@action({ UUID: "com.kylefsu.claude-harness.allow" })
export class AllowKey extends AnswerKey {
	protected readonly behavior = "allow" as const;
}

@action({ UUID: "com.kylefsu.claude-harness.deny" })
export class DenyKey extends AnswerKey {
	protected readonly behavior = "deny" as const;
}
