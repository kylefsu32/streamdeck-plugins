import { spawn } from "node:child_process";

import streamDeck, {
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyUpEvent,
	type SendToPluginEvent,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

import type { AppUsage } from "../collectors/parse";
import { face, nextMetric, type Category, type Settings } from "../metrics";
import { hub } from "../sampler/instance";

/**
 * One class drives every stat key; subclasses only pick the category.
 *
 * Settings are cached per key so the once-a-second repaint never round-trips
 * to the Stream Deck app, and an image is only sent when it actually changed.
 */
export abstract class StatAction extends SingletonAction<Settings> {
	abstract readonly category: Category;

	readonly #settings = new Map<string, Settings>();
	readonly #lastImage = new Map<string, string>();
	#listening = false;

	override onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings ?? {});
		this.#lastImage.delete(ev.action.id);
		if (!this.#listening) {
			this.#listening = true;
			hub.on("tick", () => void this.#paintAll());
		}
		return this.#paint(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.#settings.delete(ev.action.id);
		this.#lastImage.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings ?? {});
		return this.#paint(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
		const settings = ev.payload.settings ?? {};
		const press = settings.press ?? "monitor";
		if (press === "cycle") {
			const next = { ...settings, metric: nextMetric(this.category, settings) };
			this.#settings.set(ev.action.id, next);
			await ev.action.setSettings(next);
			await this.#paint(ev.action.id);
		} else if (press === "monitor") {
			const child = spawn("open", ["-a", "Activity Monitor"], { detached: true, stdio: "ignore" });
			child.on("error", () => void ev.action.showAlert());
			child.unref();
		}
	}

	/** Feeds the property inspector's dynamic dropdowns (interfaces, running apps). */
	override async onSendToPlugin(ev: SendToPluginEvent<{ event?: string }, Settings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		const event = payload?.event;
		if (event === "getInterfaces") {
			hub.want("net");
			const names = hub.snapshot<string[]>("net.interfaces") ?? [];
			await streamDeck.ui.sendToPropertyInspector({
				event,
				items: [{ label: "All Wi-Fi & Ethernet", value: "auto" }, ...names.map((n) => ({ label: n, value: n }))]
			});
		} else if (event === "getApps") {
			hub.want("proc");
			const apps = [...(hub.snapshot<AppUsage[]>("proc") ?? [])]
				.sort((a, b) => b.cpu + b.rss / 1e9 - (a.cpu + a.rss / 1e9))
				.slice(0, 60)
				.sort((a, b) => a.name.localeCompare(b.name));
			await streamDeck.ui.sendToPropertyInspector({
				event,
				items: apps.map((a) => ({ label: a.name, value: a.name }))
			});
		}
	}

	async #paintAll(): Promise<void> {
		await Promise.all([...this.#settings.keys()].map((id) => this.#paint(id)));
	}

	async #paint(id: string): Promise<void> {
		const settings = this.#settings.get(id);
		const instance = [...this.actions].find((a) => a.id === id);
		if (!settings || !instance) {
			return;
		}
		let image: string;
		try {
			image = face(hub, this.category, settings);
		} catch (err) {
			streamDeck.logger.error(`render failed for ${this.category}`, err);
			return;
		}
		if (this.#lastImage.get(id) === image) {
			return;
		}
		this.#lastImage.set(id, image);
		try {
			await instance.setImage(image);
		} catch (err) {
			streamDeck.logger.warn("setImage failed", err);
		}
	}
}
