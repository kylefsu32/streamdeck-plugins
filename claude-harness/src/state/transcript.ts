import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/**
 * The recap of a finished turn: the last thing Claude said, as plain text.
 *
 * Newer Claude Code versions hand the Stop hook `last_assistant_message`
 * directly; older ones only give the transcript path, so this reads the tail
 * of the JSONL and walks back to the newest assistant text block. Only the
 * tail: a long session's transcript runs to tens of megabytes, and the hook
 * has five seconds.
 */
export function lastAssistantText(transcriptPath: string | undefined, tailBytes = 512 * 1024): string {
	if (!transcriptPath) return "";
	let fd: number | undefined;
	try {
		fd = openSync(transcriptPath, "r");
		const size = fstatSync(fd).size;
		const start = Math.max(0, size - tailBytes);
		const buf = Buffer.alloc(size - start);
		readSync(fd, buf, 0, buf.length, start);
		const lines = buf.toString("utf8").split("\n");
		for (let i = lines.length - 1; i >= 0; i--) {
			const text = assistantText(lines[i] ?? "");
			if (text) return text;
		}
	} catch {
		// No transcript, unreadable, or mid-write: the recap just says "Finished".
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
	return "";
}

function assistantText(line: string): string {
	if (!line.includes('"assistant"')) return "";
	try {
		const entry = JSON.parse(line) as {
			type?: string;
			isSidechain?: boolean;
			message?: { role?: string; content?: unknown };
		};
		if (entry.type !== "assistant" || entry.isSidechain) return "";
		const content = entry.message?.content;
		if (typeof content === "string") return content.trim();
		if (!Array.isArray(content)) return "";
		return content
			.filter((b): b is { type: string; text: string } => b?.type === "text" && typeof b.text === "string")
			.map((b) => b.text)
			.join("\n")
			.trim();
	} catch {
		return "";
	}
}

/**
 * Markdown is noise on a 72-pixel key. Keep the words, drop the markup, and
 * flatten to one paragraph the renderer can wrap.
 */
export function plainRecap(markdown: string, max = 400): string {
	const text = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*\d+\.\s+/gm, "")
		.replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
