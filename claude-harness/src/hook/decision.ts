import type { HookInput } from "../state/reduce";
import { safeUpdate } from "../state/rules";
import type { Answer } from "../state/types";

/** What the hook prints for Claude Code, or nothing to let the terminal take over. */
export function decision(input: HookInput, answer: Answer): unknown {
	if (answer.behavior === "terminal") return undefined;
	if (input.hook_event_name === "PreToolUse") {
		if (answer.behavior !== "allow" || !answer.answers) return undefined;
		return {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow",
				permissionDecisionReason: "Answered on the Stream Deck.",
				updatedInput: { ...(input.tool_input ?? {}), answers: answer.answers }
			}
		};
	}
	const wrap = (d: unknown) => ({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: d } });
	if (answer.behavior === "deny") return wrap({ behavior: "deny", message: "Denied from the Stream Deck." });
	if (answer.behavior === "always") {
		// Recomputed from Claude Code's own input, so only the rule the key showed can be saved.
		const update = safeUpdate(input.permission_suggestions, input.tool_name ?? "", answer.sessionOnly);
		return update ? wrap({ behavior: "allow", updatedPermissions: [update] }) : undefined;
	}
	return wrap({ behavior: "allow" });
}
