/**
 * Long-press detection.
 *
 * The Stream Deck SDK has no long-press event — only `onKeyDown` and
 * `onKeyUp` — so it has to be timed. A timer armed on key-down fires the long
 * action while the key is still held, which is what makes it feel like a long
 * press rather than a slow click; the subsequent key-up is then swallowed so a
 * long press never also performs the short one.
 */

export type LongPressHandler = () => void;

export class LongPressTracker {
	readonly #timers = new Map<string, NodeJS.Timeout>();
	readonly #consumed = new Set<string>();

	/** Arms the long-press timer for this key instance. */
	down(id: string, thresholdMs: number, onLongPress: LongPressHandler): void {
		this.cancel(id);
		this.#consumed.delete(id);

		const timer = setTimeout(() => {
			this.#timers.delete(id);
			this.#consumed.add(id);
			onLongPress();
		}, Math.max(150, thresholdMs));

		this.#timers.set(id, timer);
	}

	/**
	 * Disarms the timer. Returns true when this was a short press and the caller
	 * should perform the short action, false when the long action already ran.
	 */
	up(id: string): boolean {
		this.cancel(id);
		if (this.#consumed.has(id)) {
			this.#consumed.delete(id);
			return false;
		}
		return true;
	}

	/** Drops any pending timer, e.g. when the key leaves the canvas. */
	cancel(id: string): void {
		const timer = this.#timers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.#timers.delete(id);
		}
	}
}
