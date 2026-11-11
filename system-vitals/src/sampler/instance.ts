import { collectorFor } from "../collectors/index";
import { Hub } from "./hub";

/** The single hub shared by every key. */
export const hub = new Hub(collectorFor);
