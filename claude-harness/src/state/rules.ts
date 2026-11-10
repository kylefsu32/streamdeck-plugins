/**
 * "Always allow" without surprises.
 *
 * Claude Code's PermissionRequest input carries `permission_suggestions` — the
 * updates its own dialog would save for "Yes, and don't ask again". The rules
 * here follow what tapparello/agent-vitals (MIT) learned on real hardware:
 *
 * - Echo back only one kind of update: an `addRules` allow with a concrete
 *   rule. A `setMode` or `addDirectories` grants far more than a key can show.
 * - Never for MCP tools: their suggestions are often whole-tool grants.
 * - Exactly one rule, short enough to read in full, or the key refuses. The
 *   key shows the RULE (`Bash(gh pr *)`), not the command, because the rule is
 *   what gets saved.
 * - Save to the project's local settings (or the session), never user settings.
 * - After a Deny, Claude retries the same call within about two seconds, and
 *   the retry looks identical. For 30 seconds Always refuses any rule that
 *   would re-permit what was just denied.
 */

export type PermissionUpdate = {
	type: "addRules";
	behavior: "allow";
	destination: "localSettings" | "session";
	rules: Array<{ toolName: string; ruleContent: string }>;
};

export const RULE_MAX = 40;
export const DENY_GUARD_MS = 30_000;

export function safeUpdate(suggestions: unknown, toolName: string, sessionOnly = false): PermissionUpdate | null {
	if (!Array.isArray(suggestions) || toolName.startsWith("mcp__")) return null;
	const safe: PermissionUpdate[] = [];
	for (const s of suggestions as Array<Record<string, unknown>>) {
		if (!s || s.type !== "addRules" || s.behavior !== "allow" || !Array.isArray(s.rules)) continue;
		const rules = (s.rules as Array<Record<string, unknown>>)
			.filter((r) => r && typeof r.toolName === "string" && r.toolName && typeof r.ruleContent === "string" && r.ruleContent)
			.map((r) => ({ toolName: r.toolName as string, ruleContent: r.ruleContent as string }));
		if (!rules.length) continue;
		const destination = sessionOnly || s.destination === "session" ? "session" : "localSettings";
		safe.push({ type: "addRules", behavior: "allow", destination, rules });
	}
	if (safe.length !== 1 || safe[0]!.rules.length !== 1) return null;
	return ruleText(safe[0]!).length > RULE_MAX ? null : safe[0]!;
}

export function ruleText(update: PermissionUpdate): string {
	const r = update.rules[0]!;
	return `${r.toolName}(${r.ruleContent})`.replace(/[\s\p{Cc}]+/gu, " ").trim();
}

export type RecentDeny = { rule: string; at: number };

export function rememberDeny(denies: RecentDeny[], rule: string | undefined, now: number): RecentDeny[] {
	const kept = denies.filter((d) => now - d.at < DENY_GUARD_MS && d.rule !== rule);
	return rule ? [...kept, { rule, at: now }] : kept;
}

export function justDenied(denies: RecentDeny[], rule: string | undefined, now: number): boolean {
	return !!rule && denies.some((d) => d.rule === rule && now - d.at < DENY_GUARD_MS);
}
