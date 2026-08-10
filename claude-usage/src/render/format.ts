/** 12_300_000 -> "12.3M". Kept short enough for a 144px key. */
export function compactTokens(value: number): string {
	const n = Math.max(0, value);
	if (n < 1_000) {
		return String(Math.round(n));
	}
	if (n < 1_000_000) {
		const k = n / 1_000;
		return `${k < 100 ? k.toFixed(1) : Math.round(k)}K`;
	}
	if (n < 1_000_000_000) {
		const m = n / 1_000_000;
		return `${m < 100 ? m.toFixed(1) : Math.round(m)}M`;
	}
	return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** Percentage for the centre readout; stays legible past 100%. */
export function percentLabel(fraction: number): string {
	const pct = fraction * 100;
	if (pct >= 999) {
		return "999%";
	}
	return `${Math.round(pct)}%`;
}

/** 8_040_000 -> "2h14". Compact enough to sit inside the rings. */
export function compactDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return "—";
	}
	const totalMinutes = Math.floor(ms / 60_000);
	if (totalMinutes < 1) {
		return "<1m";
	}
	if (totalMinutes < 60) {
		return `${totalMinutes}m`;
	}
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours < 24) {
		return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, "0")}`;
	}
	const days = Math.floor(hours / 24);
	return `${days}d${hours % 24}h`;
}
