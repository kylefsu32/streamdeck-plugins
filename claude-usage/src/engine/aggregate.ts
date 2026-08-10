import { DEFAULT_WEIGHTS, effectiveTokens, type ModelWeights, type UsageSample, type Weights } from "./types";

export type WindowStat = {
	/** Width of the window in milliseconds. */
	windowMs: number;
	/** Weighted "effective input token" total inside the window. */
	effective: number;
	/** Number of distinct API calls counted. */
	calls: number;
	/** Timestamp of the earliest counted call, if any. */
	oldestTs?: number;
	/** Timestamp of the most recent counted call, if any. */
	newestTs?: number;
	raw: {
		input: number;
		cacheWrite: number;
		cacheRead: number;
		output: number;
	};
};

export type AggregateOptions = {
	weights?: Weights;
	modelWeights?: ModelWeights;
	/**
	 * Case-insensitive substring matched against the model id, so "fable" picks
	 * up `claude-fable-5` and "opus" covers every Opus revision. Empty or
	 * omitted counts every model.
	 */
	modelFilter?: string;
};

function matchesModel(model: string, filter: string | undefined): boolean {
	if (!filter) {
		return true;
	}
	const needle = filter.trim().toLowerCase();
	return needle.length === 0 || model.toLowerCase().includes(needle);
}

/** Totals for the trailing `windowMs`, ending at `now`. */
export function summarise(
	samples: readonly UsageSample[],
	now: number,
	windowMs: number,
	options: AggregateOptions = {}
): WindowStat {
	const weights = options.weights ?? DEFAULT_WEIGHTS;
	const cutoff = now - windowMs;

	const stat: WindowStat = {
		windowMs,
		effective: 0,
		calls: 0,
		raw: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
	};

	for (const sample of samples) {
		if (sample.ts < cutoff || sample.ts > now) {
			continue;
		}
		if (!matchesModel(sample.model, options.modelFilter)) {
			continue;
		}
		stat.effective += effectiveTokens(sample, weights, options.modelWeights);
		stat.calls += 1;
		stat.raw.input += sample.input;
		stat.raw.cacheWrite += sample.cacheWrite5m + sample.cacheWrite1h;
		stat.raw.cacheRead += sample.cacheRead;
		stat.raw.output += sample.output;
		if (stat.oldestTs === undefined || sample.ts < stat.oldestTs) {
			stat.oldestTs = sample.ts;
		}
		if (stat.newestTs === undefined || sample.ts > stat.newestTs) {
			stat.newestTs = sample.ts;
		}
	}

	return stat;
}

/**
 * Effective tokens per hour over the trailing `windowMs`.
 *
 * Measured against elapsed wall-clock time rather than time-since-first-call, so
 * an idle stretch correctly drags the rate down.
 */
export function burnRatePerHour(
	samples: readonly UsageSample[],
	now: number,
	windowMs: number,
	options: AggregateOptions = {}
): number {
	const stat = summarise(samples, now, windowMs, options);
	const hours = windowMs / 3_600_000;
	return hours > 0 ? stat.effective / hours : 0;
}

/**
 * Milliseconds until `ceiling` is reached at the current burn rate, or
 * undefined if the rate is zero or the ceiling is already passed.
 */
export function timeToCeiling(used: number, ceiling: number, ratePerHour: number): number | undefined {
	if (ratePerHour <= 0 || ceiling <= 0) {
		return undefined;
	}
	const remaining = ceiling - used;
	if (remaining <= 0) {
		return 0;
	}
	return (remaining / ratePerHour) * 3_600_000;
}

/**
 * Per-model totals for the window, heaviest first. Used by the calibration
 * report so a per-model key can be given a sensible ceiling.
 */
export function summariseByModel(
	samples: readonly UsageSample[],
	now: number,
	windowMs: number,
	options: AggregateOptions = {}
): { model: string; stat: WindowStat }[] {
	const models = new Set<string>();
	const cutoff = now - windowMs;
	for (const sample of samples) {
		if (sample.ts >= cutoff && sample.ts <= now) {
			models.add(sample.model);
		}
	}

	return [...models]
		.map((model) => ({
			model,
			// An exact-match filter, so "claude-opus-5" cannot swallow a sibling.
			stat: summarise(
				samples.filter((s) => s.model === model),
				now,
				windowMs,
				{ ...options, modelFilter: undefined }
			)
		}))
		.sort((a, b) => b.stat.effective - a.stat.effective);
}

/** 0..n fraction of the ceiling consumed. Values above 1 mean over budget. */
export function fraction(used: number, ceiling: number): number {
	if (!Number.isFinite(ceiling) || ceiling <= 0) {
		return 0;
	}
	return used / ceiling;
}
