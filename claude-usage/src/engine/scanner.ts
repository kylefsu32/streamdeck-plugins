import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { UsageSample } from "./types";

/** Where Claude Code keeps its transcripts, honouring CLAUDE_CONFIG_DIR. */
export function defaultTranscriptRoot(): string {
	const configured = process.env["CLAUDE_CONFIG_DIR"];
	const base = configured && configured.trim().length > 0 ? configured : path.join(homedir(), ".claude");
	return path.join(base, "projects");
}

/**
 * Guard against a single pathological transcript. On first sight of a file we
 * read at most this much, starting from the tail.
 */
const MAX_FIRST_READ = 64 * 1024 * 1024;

type FileCursor = {
	/** Byte offset we have consumed up to. */
	offset: number;
	/** Size at last scan, so we can detect truncation or replacement. */
	size: number;
	/** Trailing bytes of an incomplete final line. */
	carry: string;
};

async function* walkJsonl(dir: string): AsyncGenerator<string> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return; // directory missing or unreadable — treated as "no data"
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkJsonl(full);
		} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
			yield full;
		}
	}
}

/**
 * Reads Claude Code transcripts into deduplicated usage samples.
 *
 * The important subtlety: a single API response is written to the transcript as
 * one line per content block, and **every one of those lines carries a full
 * copy of the same cumulative `usage` object**. Summing the lines therefore
 * multi-counts every call — on a real corpus the naive total came out 2.8x too
 * high. `requestId` identifies the underlying call, so we count each one once.
 */
export class TranscriptScanner {
	readonly #root: string;
	readonly #cursors = new Map<string, FileCursor>();
	readonly #seen = new Map<string, number>();

	#retentionMs: number;
	#samples: UsageSample[] = [];
	#lastError: string | undefined;
	#duplicatesSkipped = 0;

	constructor(options: { root?: string; retentionMs: number }) {
		this.#root = options.root ?? defaultTranscriptRoot();
		this.#retentionMs = options.retentionMs;
	}

	get root(): string {
		return this.#root;
	}

	get retentionMs(): number {
		return this.#retentionMs;
	}

	/**
	 * Widening the window makes previously skipped files eligible again; the
	 * cursor map is cleared so their history is re-read on the next scan.
	 */
	set retentionMs(value: number) {
		if (value > this.#retentionMs) {
			this.#cursors.clear();
		}
		this.#retentionMs = value;
	}

	get lastError(): string | undefined {
		return this.#lastError;
	}

	/**
	 * Transcript lines that repeated a `requestId` already counted. Diagnostic
	 * only — but it is the whole reason this plugin exists, so it is worth
	 * being able to see.
	 */
	get duplicatesSkipped(): number {
		return this.#duplicatesSkipped;
	}

	/** Deduplicated samples inside the retention window, oldest first. */
	get samples(): readonly UsageSample[] {
		return this.#samples;
	}

	/**
	 * Reads whatever is new since the last call and drops anything that has
	 * aged out of the retention window.
	 */
	async scan(now: number = Date.now()): Promise<void> {
		const cutoff = now - this.#retentionMs;
		this.#lastError = undefined;

		try {
			for await (const file of walkJsonl(this.#root)) {
				await this.#ingestFile(file, cutoff);
			}
		} catch (err) {
			this.#lastError = err instanceof Error ? err.message : String(err);
		}

		this.#evict(cutoff);
	}

	async #ingestFile(file: string, cutoff: number): Promise<void> {
		let info;
		try {
			info = await stat(file);
		} catch {
			return;
		}

		const cursor = this.#cursors.get(file);

		// A file untouched since before the window can only hold expired data.
		// Skip it unless we have already been tracking it (a tracked file that
		// stopped growing still needs no re-read, so this is safe either way).
		if (info.mtimeMs < cutoff && !cursor) {
			return;
		}

		if (!cursor) {
			const start = Math.max(0, info.size - MAX_FIRST_READ);
			this.#cursors.set(file, { offset: start, size: info.size, carry: "" });
			await this.#readDelta(file, info.size);
			return;
		}

		if (info.size < cursor.size) {
			// Truncated or replaced — start over rather than read garbage.
			cursor.offset = 0;
			cursor.carry = "";
		}

		if (info.size === cursor.offset) {
			cursor.size = info.size;
			return; // nothing appended
		}

		await this.#readDelta(file, info.size);
	}

	async #readDelta(file: string, size: number): Promise<void> {
		const cursor = this.#cursors.get(file);
		if (!cursor) {
			return;
		}

		const length = size - cursor.offset;
		if (length <= 0) {
			cursor.size = size;
			return;
		}

		let text: string;
		const handle = await open(file, "r");
		try {
			const buffer = Buffer.allocUnsafe(length);
			const { bytesRead } = await handle.read(buffer, 0, length, cursor.offset);
			text = cursor.carry + buffer.subarray(0, bytesRead).toString("utf8");
			cursor.offset += bytesRead;
		} finally {
			await handle.close();
		}
		cursor.size = size;

		const lines = text.split("\n");
		// The final element is either "" (clean newline) or a partial line.
		cursor.carry = lines.pop() ?? "";

		for (const line of lines) {
			this.#ingestLine(line);
		}
	}

	#ingestLine(line: string): void {
		// Cheap prefilter: most lines are user/tool entries with no usage block,
		// and JSON.parse on a 150MB corpus is the whole cost of this scanner.
		if (line.length < 40 || !line.includes('"usage"')) {
			return;
		}

		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			return; // half-written line, or not JSON — ignore
		}

		if (entry?.type !== "assistant") {
			return;
		}

		const usage = entry.message?.usage;
		const requestId = entry.requestId;
		// Synthetic entries carry no requestId and no billable call.
		if (!usage || typeof requestId !== "string" || requestId.length === 0) {
			return;
		}
		if (this.#seen.has(requestId)) {
			this.#duplicatesSkipped += 1;
			return; // already counted from another content block of the same call
		}

		const ts = Date.parse(entry.timestamp ?? "");
		if (!Number.isFinite(ts)) {
			return;
		}

		const creation = usage.cache_creation;
		const totalCreate = num(usage.cache_creation_input_tokens);
		let write5m = num(creation?.ephemeral_5m_input_tokens);
		let write1h = num(creation?.ephemeral_1h_input_tokens);
		if (write5m + write1h === 0 && totalCreate > 0) {
			// Older transcripts omit the TTL breakdown; 5m was the default then.
			write5m = totalCreate;
			write1h = 0;
		}

		this.#seen.set(requestId, ts);
		this.#samples.push({
			ts,
			requestId,
			model: typeof entry.message?.model === "string" ? entry.message.model : "unknown",
			input: num(usage.input_tokens),
			cacheWrite5m: write5m,
			cacheWrite1h: write1h,
			cacheRead: num(usage.cache_read_input_tokens),
			output: num(usage.output_tokens)
		});
	}

	#evict(cutoff: number): void {
		if (this.#samples.length === 0) {
			return;
		}
		const kept: UsageSample[] = [];
		for (const sample of this.#samples) {
			if (sample.ts >= cutoff) {
				kept.push(sample);
			} else {
				this.#seen.delete(sample.requestId);
			}
		}
		kept.sort((a, b) => a.ts - b.ts);
		this.#samples = kept;
	}
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
