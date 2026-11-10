import type { JsonObject } from "@elgato/utils";
import streamDeck from "@elgato/streamdeck";
import path from "node:path";

import { AgentKey, AllowKey, AlwaysKey, DenyKey, InboxKey, OptionKey, OverviewKey, QuestionKey, TerminalKey } from "./actions/keys";
import { Takeover } from "./system/takeover";
import { store } from "./state/store";
import { applyHooks, hookCommand } from "./system/install";

streamDeck.logger.setLevel("info");
const log = streamDeck.logger.createScope("harness");

process.on("uncaughtException", (err) => log.error("uncaught exception", err));
process.on("unhandledRejection", (reason) => log.error("unhandled rejection", reason));

/** Settings shared by every key, edited from any key's property inspector. */
type GlobalSettings = JsonObject & {
	/** Seconds a permission prompt waits for the deck. 0 = never hold. */
	holdSeconds?: number | string;
	/** Seconds one of Claude's multiple-choice questions waits for the deck. */
	questionHoldSeconds?: number | string;
	/** Jump to the answer page when a question arrives. On unless switched off. */
	takeover?: boolean | string;
	/** Leave ~/.claude/settings.json alone; the hook is installed by hand. */
	manualHooks?: boolean;
};

function applyGlobals(g: GlobalSettings): void {
	const seconds = (v: unknown) => (v === undefined || v === "" ? NaN : Number(v));
	const hold = seconds(g.holdSeconds);
	if (Number.isFinite(hold) && hold >= 0) store.setConfig({ holdSeconds: Math.min(300, hold) });
	const qHold = seconds(g.questionHoldSeconds);
	if (Number.isFinite(qHold) && qHold >= 0) store.setConfig({ questionHoldSeconds: Math.min(300, qHold) });
	takeover.enabled = g.takeover !== false && g.takeover !== "false";

	if (g.manualHooks) return;
	// The plugin folder is the working directory, and the bundled hook sits in
	// bin/ next to plugin.js. Re-applied on every start: when the Stream Deck app
	// updates its bundled Node, the path in settings.json follows.
	const hookScript = path.join(process.cwd(), "bin", "hook.mjs");
	const out = applyHooks(hookCommand(process.execPath, hookScript));
	if (out.result === "failed") log.error(`could not install Claude Code hooks in ${out.file}: ${out.error}`);
	else log.info(`Claude Code hooks ${out.result} (${out.file})`);
}

streamDeck.actions.registerAction(new AgentKey());
streamDeck.actions.registerAction(new OverviewKey());
streamDeck.actions.registerAction(new InboxKey());
streamDeck.actions.registerAction(new QuestionKey());
streamDeck.actions.registerAction(new AllowKey());
streamDeck.actions.registerAction(new DenyKey());
streamDeck.actions.registerAction(new AlwaysKey());
streamDeck.actions.registerAction(new OptionKey());
streamDeck.actions.registerAction(new TerminalKey());

const takeover = new Takeover(log);

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => applyGlobals(ev.settings));

store.start();

streamDeck
	.connect()
	.then(async () => {
		log.info("connected to Stream Deck");
		applyGlobals(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
	})
	.catch((err) => log.error("failed to connect", err));
