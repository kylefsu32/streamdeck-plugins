import streamDeck from "@elgato/streamdeck";

import { UsageGauge } from "./actions/usage-gauge";

streamDeck.logger.setLevel("info");
streamDeck.actions.registerAction(new UsageGauge());
streamDeck.connect();
