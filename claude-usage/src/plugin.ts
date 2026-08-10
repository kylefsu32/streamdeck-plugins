import streamDeck from "@elgato/streamdeck";

import { BurnRate } from "./actions/burn-rate";
import { UsageRings } from "./actions/usage-rings";

streamDeck.actions.registerAction(new UsageRings());
streamDeck.actions.registerAction(new BurnRate());

streamDeck.connect();
