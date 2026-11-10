import type { JsonObject } from "@elgato/utils";
import streamDeck, {
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import { dataUrl } from "../render/svg";
import { store } from "../state/store";

/** One clock for every key, so spinners and pulses move together. */
let tick = 0;
const tickers = new Set<() => void>();
setInterval(() => {
	tick += 1;
	for (const fn of tickers) fn();
}, 1000);

export const clock = { get tick() { return tick; } };

/**
 * A key that draws itself from the store.
 *
 * Subclasses only say what the face is; this keeps each instance's settings,
 * repaints on every store change and every second, and skips setImage when
 * the picture has not changed — a deck full of idle keys sends nothing.
 */
export abstract class StoreAction<S extends JsonObject = JsonObject> extends SingletonAction<S> {
	readonly #settings = new Map<string, S>();
	readonly #lastImage = new Map<string, string>();
	readonly #instances = new Map<string, KeyAction<S>>();
	#unsubscribe: (() => void) | undefined;
	readonly #repaint = () => this.paintAll();

	/** The SVG for one instance. */
	protected abstract render(settings: S, id: string): string;

	protected settingsOf(id: string): S {
		return this.#settings.get(id) ?? ({} as S);
	}

	override onWillAppear(ev: WillAppearEvent<S>): void {
		if (!ev.action.isKey()) return;
		this.#instances.set(ev.action.id, ev.action);
		this.#settings.set(ev.action.id, ev.payload.settings ?? ({} as S));
		this.#lastImage.delete(ev.action.id);
		if (!this.#unsubscribe) {
			this.#unsubscribe = store.subscribe(this.#repaint);
			tickers.add(this.#repaint);
		}
		this.appeared(ev.action.id);
		this.paint(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<S>): void {
		this.#instances.delete(ev.action.id);
		this.#settings.delete(ev.action.id);
		this.#lastImage.delete(ev.action.id);
		this.disappeared(ev.action.id);
		if (this.#instances.size === 0) {
			this.#unsubscribe?.();
			this.#unsubscribe = undefined;
			tickers.delete(this.#repaint);
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): void {
		this.#settings.set(ev.action.id, ev.payload.settings ?? ({} as S));
		this.paint(ev.action.id);
	}

	protected appeared(_id: string): void {}
	protected disappeared(_id: string): void {}

	protected instance(id: string): KeyAction<S> | undefined {
		return this.#instances.get(id);
	}

	paintAll(): void {
		for (const id of this.#instances.keys()) this.paint(id);
	}

	paint(id: string): void {
		const action = this.#instances.get(id);
		if (!action) return;
		let image: string;
		try {
			image = dataUrl(this.render(this.settingsOf(id), id));
		} catch (err) {
			streamDeck.logger.error(`render failed for ${this.manifestId}`, err);
			return;
		}
		if (this.#lastImage.get(id) === image) return;
		this.#lastImage.set(id, image);
		action.setImage(image).catch(() => this.#lastImage.delete(id));
	}
}
