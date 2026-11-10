import streamDeck, { DeviceType } from "@elgato/streamdeck";

type Log = { warn(...args: unknown[]): void };

import { store } from "../state/store";

/**
 * Jumps the deck to the answer page while one of Claude's multiple-choice
 * questions is held for it, and back to whatever was showing afterwards — the
 * flow hardkoded/streamdeck-claude-answer uses, so a question is one press
 * away without giving up keys to option buttons the rest of the time.
 *
 * Plugins may only switch to profiles they ship, so each device type has an
 * answer page in the manifest. Devices without one are left alone.
 */
const ANSWER_PROFILES: Partial<Record<DeviceType, string>> = {
	[DeviceType.StreamDeck]: "Claude Harness Answer",
	[DeviceType.StreamDeckMini]: "Claude Harness Answer Mini",
	[DeviceType.StreamDeckXL]: "Claude Harness Answer XL",
	[DeviceType.StreamDeckPlus]: "Claude Harness Answer Plus"
};

export class Takeover {
	#enabled = true;
	#showing: string | undefined;
	#switched = new Set<string>();
	#advertised: boolean | undefined;

	constructor(private readonly log: Log) {
		store.subscribe(() => this.#update());
		setInterval(() => this.#update(), 1000);
	}

	set enabled(on: boolean) {
		this.#enabled = on;
		this.#update();
	}

	#devices() {
		return [...streamDeck.devices].filter((d) => d.isConnected && ANSWER_PROFILES[d.type]);
	}

	#update(): void {
		// Tell the hook a question is worth holding only while a deck can actually jump to it.
		const canJump = this.#enabled && this.#devices().length > 0;
		if (canJump !== this.#advertised) {
			this.#advertised = canJump;
			store.setTakeover(canJump);
		}

		const q = store.currentQuestion?.question;
		const want =
			this.#enabled && !!q?.choices?.length && q.answerable && (!q.holdUntil || q.holdUntil > Date.now()) ? q.id : undefined;
		if (want === this.#showing) return;

		if (want && !this.#showing) {
			for (const d of this.#devices()) {
				streamDeck.profiles
					.switchToProfile(d.id, ANSWER_PROFILES[d.type])
					.then(() => this.#switched.add(d.id))
					.catch((err) => this.log.warn(`could not switch ${d.name} to the answer page`, err));
			}
		} else if (!want) {
			// Back to whatever was on screen before the question.
			for (const id of this.#switched) streamDeck.profiles.switchToProfile(id).catch(() => {});
			this.#switched.clear();
		}
		this.#showing = want;
	}
}
