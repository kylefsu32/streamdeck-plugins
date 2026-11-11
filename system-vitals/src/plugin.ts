import streamDeck from "@elgato/streamdeck";

import { ALL_ACTIONS } from "./actions/index";
import { ledger } from "./collectors/index";
import { hub } from "./sampler/instance";

const log = streamDeck.logger.createScope("plugin");

process.on("uncaughtException", (err) => log.error("uncaught exception", err));
process.on("unhandledRejection", (reason) => log.error("unhandled rejection", reason));
process.on("exit", () => ledger.save());

hub.on("collect-error", (key: string, err: unknown) => log.warn(`collector ${key} failed`, err));

// CPU and memory are cheap and almost always on the deck, so they sample from
// launch: a newly placed key shows a full graph instead of an empty one.
hub.pin("cpu");
hub.pin("mem");
// The hub's own interval keeps the event loop alive for the life of the plugin.
hub.start();

for (const Action of ALL_ACTIONS) {
	streamDeck.actions.registerAction(new Action());
}

streamDeck
	.connect()
	.then(() => log.info("connected to Stream Deck"))
	.catch((err) => log.error("failed to connect", err));
