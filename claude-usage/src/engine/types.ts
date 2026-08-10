/** One billed API call, deduplicated by `requestId`. */
export type UsageSample = {
	/** Epoch milliseconds, from the transcript entry's `timestamp`. */
	ts: number;
	requestId: string;
	model: string;
	input: number;
	cacheWrite5m: number;
	cacheWrite1h: number;
	cacheRead: number;
	output: number;
};

/**
 * Cost of each token class relative to a plain input token.
 *
 * These mirror Anthropic's published price ratios: a 5-minute cache write is
 * 1.25x an input token, a 1-hour write is 2x, a cache read is 0.1x, and an
 * output token is 5x. Working in "effective input tokens" keeps a heavily
 * cached session from looking artificially enormous.
 */
export type Weights = {
	input: number;
	cacheWrite5m: number;
	cacheWrite1h: number;
	cacheRead: number;
	output: number;
};

export const DEFAULT_WEIGHTS: Weights = {
	input: 1,
	cacheWrite5m: 1.25,
	cacheWrite1h: 2,
	cacheRead: 0.1,
	output: 5
};

/**
 * Per-model multiplier applied on top of the token weights.
 *
 * Defaults to 1 for every model. Claude Code's own limits do weight models
 * differently, but the exact ratios are not published anywhere we can read, and
 * inventing them would add error rather than remove it. Since the ceiling is
 * calibrated by hand against `/usage`, a uniform weight is self-correcting as
 * long as the model mix is roughly stable. Override per model if yours isn't.
 */
export type ModelWeights = Record<string, number>;

export function weightFor(model: string, weights: ModelWeights | undefined): number {
	if (!weights) {
		return 1;
	}
	const exact = weights[model];
	if (typeof exact === "number") {
		return exact;
	}
	// Allow prefix rules like "claude-opus" matching "claude-opus-4-8".
	for (const [key, value] of Object.entries(weights)) {
		if (model.startsWith(key)) {
			return value;
		}
	}
	return 1;
}

/** Effective token cost of a single call. */
export function effectiveTokens(sample: UsageSample, weights: Weights, models?: ModelWeights): number {
	const base =
		sample.input * weights.input +
		sample.cacheWrite5m * weights.cacheWrite5m +
		sample.cacheWrite1h * weights.cacheWrite1h +
		sample.cacheRead * weights.cacheRead +
		sample.output * weights.output;

	return base * weightFor(sample.model, models);
}
