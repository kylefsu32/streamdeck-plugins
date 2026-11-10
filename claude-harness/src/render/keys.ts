import type { Agent } from "../state/store";
import type { Question } from "../state/types";
import { arc, circle, COLOURS, frame, lines, ring, SIZE, text, truncate, wrap } from "./svg";

/**
 * The key faces. Each is a pure function of data and a clock, so the preview
 * page renders exactly what the deck shows.
 *
 * The look follows the harness device's Focus face — the pane's name on top,
 * one mark for the state in the middle, one line of what is happening below —
 * squeezed onto a 144-pixel tile with the coloured top bar the kotyzap plugin
 * uses, so a glance at the deck reads like a glance at the dial.
 */

const CX = SIZE / 2;
const MARK_Y = 66;
const MARK_R = 21;
const TEXT_W = 128;

/** What one agent looks like right now, collapsed to the five faces the device has. */
export type Mood = "working" | "asking" | "done" | "error" | "idle" | "asleep";

export function moodOf(a: Agent): Mood {
	if (a.state === "asking") return "asking";
	if (a.state === "working") return "working";
	if (a.state === "error" && a.unseen) return "error";
	if (a.state === "done" && a.unseen) return "done";
	return a.asleep ? "asleep" : "idle";
}

export const MOOD_COLOUR: Record<Mood, string> = {
	working: COLOURS.working,
	asking: COLOURS.asking,
	done: COLOURS.done,
	error: COLOURS.error,
	idle: COLOURS.idle,
	asleep: COLOURS.asleep
};

/** The device's elapsed format: "0:34", "12:05", "1h 5m". */
export function elapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return h < 24 ? `${h}h ${m}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "now", "4m", "2h", "3d" — how long ago, for idle tiles. */
export function ago(ms: number): string {
	const m = Math.floor(Math.max(0, ms) / 60_000);
	if (m < 1) return "now";
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** The middle mark. `tick` advances once a second and drives the spinner and the pulse. */
export function mark(mood: Mood, tick: number, centre = ""): string {
	const c = MOOD_COLOUR[mood];
	switch (mood) {
		case "working": {
			const a = (tick * 45) % 360;
			return (
				ring(CX, MARK_Y, MARK_R, COLOURS.track, 5) +
				arc(CX, MARK_Y, MARK_R, a, a + 100, c, 5) +
				text(CX, MARK_Y + 5, centre, { size: centre.length > 4 ? 12 : 14, weight: 700 })
			);
		}
		case "asking":
			return (
				circle(CX, MARK_Y, MARK_R + 2, c, ` opacity="${tick % 2 ? 0.55 : 1}"`) +
				text(CX, MARK_Y + 10, "?", { size: 30, weight: 700, fill: COLOURS.panel })
			);
		case "done":
			return (
				circle(CX, MARK_Y, MARK_R, c) +
				`<path d="M ${CX - 10} ${MARK_Y + 1} L ${CX - 3} ${MARK_Y + 8} L ${CX + 11} ${MARK_Y - 7}" fill="none" stroke="${COLOURS.panel}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
			);
		case "error":
			return circle(CX, MARK_Y, MARK_R, c) + text(CX, MARK_Y + 10, "!", { size: 30, weight: 700, fill: COLOURS.panel });
		case "idle":
			return ring(CX, MARK_Y, MARK_R, c, 3) + circle(CX, MARK_Y, 5, c);
		case "asleep":
			return ring(CX, MARK_Y, MARK_R, c, 3) + text(CX, MARK_Y + 6, "z", { size: 18, weight: 700, fill: c });
	}
}


/** One agent: name, state mark, and the line that says what it is doing. */
export function agentKey(a: Agent, now: number, tick: number): string {
	const mood = moodOf(a);
	const colour = MOOD_COLOUR[mood];
	const name = text(CX, 32, truncate(a.project, TEXT_W, 18, true), { size: 18, weight: 700 });

	let centre = "";
	let status: string[] = [];
	let statusColour: string = COLOURS.dim;
	switch (mood) {
		case "working":
			centre = elapsed(now - (a.turnStartedAt || a.updatedAt));
			status = wrap(a.activity || "Working", TEXT_W, 13, 2);
			statusColour = COLOURS.ink;
			break;
		case "asking":
			status = [truncate(a.question?.kind === "permission" ? `Allow ${a.question.tool}?` : "Needs you", TEXT_W, 14, true)];
			if (a.question?.detail && a.question.detail !== a.question.tool) status.push(truncate(a.question.detail, TEXT_W, 12));
			statusColour = COLOURS.asking;
			break;
		case "done":
			status = wrap(a.summary || "Finished", TEXT_W, 12, 2);
			statusColour = COLOURS.ink;
			break;
		case "error":
			status = wrap(a.summary || "Stuck", TEXT_W, 12, 2);
			statusColour = COLOURS.error;
			break;
		case "idle":
			status = [a.turnEndedAt ? `Ready · ${ago(now - a.turnEndedAt)}` : "Ready"];
			break;
		case "asleep":
			status = [`Asleep · ${ago(now - a.updatedAt)}`];
			statusColour = COLOURS.faint;
			break;
	}

	const y0 = status.length > 1 ? 113 : 120;
	return frame(
		colour,
		name +
			mark(mood, tick, centre) +
			lines(CX, y0, status, 16, {
				size: mood === "asking" && status.length ? 13 : 12.5,
				fill: statusColour,
				weight: mood === "working" ? 700 : 400
			})
	);
}

/** A slot with nobody in it. */
export function emptyAgentKey(label: string): string {
	return frame(COLOURS.track, text(CX, 32, label, { size: 16, weight: 700, fill: COLOURS.faint }) + ring(CX, MARK_Y, MARK_R, COLOURS.track, 3) + text(CX, 120, "No session", { size: 12.5, fill: COLOURS.faint }));
}

/** The dial's overview: how many need you, how many are working, how many finished unread. */
export function overviewKey(agents: readonly Agent[], tick: number): string {
	const count = (m: Mood[]) => agents.filter((a) => m.includes(moodOf(a))).length;
	const asking = count(["asking"]);
	const working = count(["working"]);
	const done = count(["done", "error"]);
	const accent = asking ? COLOURS.asking : done ? COLOURS.done : working ? COLOURS.working : COLOURS.idle;

	const row = (y: number, n: number, label: string, colour: string, pulse = false) =>
		circle(26, y - 6, 9, n ? colour : COLOURS.track, pulse && n && tick % 2 ? ` opacity="0.55"` : "") +
		text(46, y, String(n), { size: 22, weight: 700, anchor: "start", fill: n ? COLOURS.ink : COLOURS.faint }) +
		text(76, y, label, { size: 13, anchor: "start", fill: n ? COLOURS.dim : COLOURS.faint });

	const header = text(CX, 30, agents.length ? `${agents.length} session${agents.length === 1 ? "" : "s"}` : "No sessions", {
		size: 14,
		weight: 700,
		fill: COLOURS.dim
	});
	return frame(
		accent,
		header + row(64, asking, "need you", COLOURS.asking, true) + row(94, working, "working", COLOURS.working) + row(124, done, "finished", COLOURS.done)
	);
}

/** The newest unread recap — the device's notification drawer, one card at a time. */
export function inboxKey(a: Agent | undefined, unread: number): string {
	if (!a) {
		return frame(COLOURS.idle, text(CX, 32, "Inbox", { size: 16, weight: 700, fill: COLOURS.dim }) + mark("idle", 0) + text(CX, 120, "All caught up", { size: 12.5, fill: COLOURS.dim }));
	}
	const colour = a.state === "error" ? COLOURS.error : COLOURS.done;
	const badge = unread > 1 ? `${unread}` : "";
	const head =
		text(12, 30, truncate(a.project, badge ? 96 : 120, 16, true), { size: 16, weight: 700, anchor: "start" }) +
		(badge ? circle(122, 25, 12, colour) + text(122, 30, badge, { size: 13, weight: 700, fill: COLOURS.panel }) : "");
	const body = wrap(a.summary || (a.state === "error" ? "Stuck" : "Finished"), TEXT_W, 13, 6);
	return frame(colour, head + lines(12, 52, body, 16, { size: 13, anchor: "start", fill: COLOURS.ink }));
}

/** The question waiting longest, with where it can be answered. */
export function questionKey(
	entry: { agent: Agent; question: Question } | undefined,
	index: number,
	total: number,
	now: number,
	tick: number
): string {
	if (!entry) {
		return frame(COLOURS.idle, text(CX, 32, "Needs you", { size: 16, weight: 700, fill: COLOURS.dim }) + mark("idle", 0) + text(CX, 120, "All clear", { size: 12.5, fill: COLOURS.dim }));
	}
	const { agent, question } = entry;
	const head =
		text(12, 30, truncate(agent.project, total > 1 ? 92 : 120, 16, true), { size: 16, weight: 700, anchor: "start" }) +
		(total > 1 ? text(132, 30, `${index + 1}/${total}`, { size: 12, anchor: "end", fill: COLOURS.dim }) : "");
	const title =
		question.kind === "permission" ? `Allow ${question.tool}?` : question.kind === "question" ? "Question" : "Needs you";
	const detail = wrap(question.detail, TEXT_W, 12.5, 3);
	const remaining = question.answerable && question.holdUntil ? Math.ceil((question.holdUntil - now) / 1000) : 0;
	const footer =
		remaining > 0
			? text(CX, 134, `Answer on deck · ${remaining}s`, { size: 12, weight: 700, fill: COLOURS.asking, opacity: tick % 2 ? 0.7 : 1 })
			: text(CX, 134, "Answer in terminal", { size: 12, fill: COLOURS.dim });
	return frame(
		COLOURS.asking,
		head +
			text(12, 54, truncate(title, TEXT_W, 15, true), { size: 15, weight: 700, anchor: "start", fill: COLOURS.asking }) +
			lines(12, 74, detail, 15, { size: 12.5, anchor: "start" }) +
			footer
	);
}

/** Allow or Deny. Lit only while there is a held prompt it can actually answer. */
export function answerKey(kind: "allow" | "deny", live: boolean, flash: "" | "sent" | "late" = ""): string {
	const colour = kind === "allow" ? COLOURS.done : COLOURS.error;
	const fill = live ? colour : COLOURS.track;
	const glyph =
		kind === "allow"
			? `<path d="M 50 62 L 66 78 L 96 46" fill="none" stroke="${live ? COLOURS.panel : COLOURS.faint}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`
			: `<path d="M 54 44 L 90 80 M 90 44 L 54 80" fill="none" stroke="${live ? COLOURS.panel : COLOURS.faint}" stroke-width="9" stroke-linecap="round"/>`;
	const label = flash === "sent" ? "Sent" : flash === "late" ? "Too late" : kind === "allow" ? "Allow" : "Deny";
	return frame(
		live ? colour : COLOURS.track,
		circle(73, 62, 34, fill) + glyph + text(CX, 124, label, { size: 18, weight: 700, fill: live || flash ? COLOURS.ink : COLOURS.faint })
	);
}
