import { action } from "@elgato/streamdeck";

import type { Category } from "../metrics";
import { StatAction } from "./stat-action";

@action({ UUID: "com.kylefsu.system-vitals.cpu" })
export class CpuAction extends StatAction {
	readonly category: Category = "cpu";
}

@action({ UUID: "com.kylefsu.system-vitals.memory" })
export class MemoryAction extends StatAction {
	readonly category: Category = "memory";
}

@action({ UUID: "com.kylefsu.system-vitals.gpu" })
export class GpuAction extends StatAction {
	readonly category: Category = "gpu";
}

@action({ UUID: "com.kylefsu.system-vitals.disk" })
export class DiskAction extends StatAction {
	readonly category: Category = "disk";
}

@action({ UUID: "com.kylefsu.system-vitals.network" })
export class NetworkAction extends StatAction {
	readonly category: Category = "network";
}

@action({ UUID: "com.kylefsu.system-vitals.ping" })
export class PingAction extends StatAction {
	readonly category: Category = "ping";
}

@action({ UUID: "com.kylefsu.system-vitals.system" })
export class SystemAction extends StatAction {
	readonly category: Category = "system";
}

@action({ UUID: "com.kylefsu.system-vitals.top" })
export class TopAppsAction extends StatAction {
	readonly category: Category = "top";
}

@action({ UUID: "com.kylefsu.system-vitals.app" })
export class AppAction extends StatAction {
	readonly category: Category = "app";
}

export const ALL_ACTIONS = [CpuAction, MemoryAction, GpuAction, DiskAction, NetworkAction, PingAction, SystemAction, TopAppsAction, AppAction];
