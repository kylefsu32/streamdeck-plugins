/**
 * The static art, as SVG. tools/make-icons.mjs rasterises it into the PNGs
 * the manifest points at; `npm run icons` rebuilds them.
 */
import { answerKey, emptyAgentKey, inboxKey, overviewKey, questionKey } from "./render/keys";
import { arc } from "./render/svg";

const icon = (body: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${body}</svg>`;
const W = "#ffffff";

/** What a key shows before the plugin has painted it. */
export const keyArt: Record<string, string> = {
	agent: emptyAgentKey("Claude"),
	overview: overviewKey([], 0),
	inbox: inboxKey(undefined, 0),
	question: questionKey(undefined, 0, 0, 0, 0),
	allow: answerKey("allow", false),
	deny: answerKey("deny", false)
};

/** Monochrome glyphs for the action list, as Elgato's guidelines ask. */
export const actionIcons: Record<string, string> = {
	agent: icon(`<circle cx="20" cy="20" r="13" fill="none" stroke="${W}" stroke-width="3" opacity="0.35"/>${arc(20, 20, 13, 0, 120, W, 3.5)}`),
	overview: icon(
		[10, 20, 30].map((y, i) => `<circle cx="9" cy="${y}" r="3.5" fill="${W}"/><rect x="16" y="${y - 2}" width="${[18, 14, 10][i]}" height="4" rx="2" fill="${W}"/>`).join("")
	),
	inbox: icon(`<path d="M 6 22 L 11 9 L 29 9 L 34 22 L 34 31 L 6 31 Z M 6 22 L 14 22 L 16 26 L 24 26 L 26 22 L 34 22" fill="none" stroke="${W}" stroke-width="2.5" stroke-linejoin="round"/>`),
	question: icon(`<circle cx="20" cy="20" r="14" fill="none" stroke="${W}" stroke-width="3"/><text x="20" y="27" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="${W}" text-anchor="middle">?</text>`),
	allow: icon(`<path d="M 9 21 L 17 29 L 32 12" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`),
	deny: icon(`<path d="M 11 11 L 29 29 M 29 11 L 11 29" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round"/>`)
};

/** The plugin's own icon: Claude coral, the working ring. */
export const pluginIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288" viewBox="0 0 288 288">
<rect width="288" height="288" rx="60" fill="#151518"/>
<circle cx="144" cy="144" r="78" fill="none" stroke="#2a2a30" stroke-width="26"/>
${arc(144, 144, 78, 20, 250, "#d97757", 26)}
<circle cx="144" cy="144" r="22" fill="#f5b83d"/>
</svg>`;

export const categoryIcon = icon(`<circle cx="20" cy="20" r="12" fill="none" stroke="${W}" stroke-width="3.5" opacity="0.35"/>${arc(20, 20, 12, 20, 250, W, 3.5)}<circle cx="20" cy="20" r="4" fill="${W}"/>`);
