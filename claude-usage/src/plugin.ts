import streamDeck from "@elgato/streamdeck";

import { BurnRate } from "./actions/burn-rate";
import { UsageRings } from "./actions/usage-rings";

// Verbose while the plugin is being brought up on real hardware; the file log
// is the only view into what a key is actually doing.
streamDeck.logger.setLevel("debug");

const log = streamDeck.logger.createScope("plugin");

// The Stream Deck app only reports the exit code, which for a drained event
// loop is an unhelpful 0. These make the real reason land in the plugin log.
process.on("uncaughtException", (err) => log.error("uncaught exception", err));
process.on("unhandledRejection", (reason) => log.error("unhandled rejection", reason));
process.on("beforeExit", (code) => log.warn(`event loop drained, exiting with ${code}`));

/**
 * Holds the event loop open for the lifetime of the plugin.
 *
 * The Stream Deck app owns this process and decides when it should stop. Until
 * an action is placed on the canvas nothing here has any work pending, so the
 * runtime would otherwise exit the moment it went idle — which the app reports
 * as `Process stopped (unexpected): code=0x00000000` and then restarts, in a
 * loop. Deliberately not unref'd; that is the entire point of it.
 */
const keepAlive = setInterval(() => {}, 1 << 30);

log.info("registering actions");
streamDeck.actions.registerAction(new UsageRings());
streamDeck.actions.registerAction(new BurnRate());

streamDeck
	.connect()
	.then(() => log.info("connected to Stream Deck"))
	.catch((err) => {
		log.error("failed to connect", err);
		clearInterval(keepAlive);
	});
