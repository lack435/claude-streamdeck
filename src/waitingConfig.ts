import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_INACTIVE_MIN = 60;
const DEFAULT_GRACE_SEC = 180;

export type WaitingWindow = {
	/** A session is "waiting" only if active within this many ms (upper bound). */
	recentMs: number;
	/**
	 * A live-process session counts as actively-running (excluded) only if it had
	 * activity within this many ms. Beyond it, a lingering process is treated as
	 * idle/waiting — which works around Claude Code's stuck-"Running" state.
	 */
	graceMs: number;
};

/**
 * Reads the tuning window from `<nasDir>/waiting-config.json`, shared by the plugin
 * and all machine reporters. Re-read each cycle so edits apply with no restart.
 * Falls back to defaults (60 min / 180 s) when the file is missing or invalid.
 */
export function readWaitingWindow(nasDir: string): WaitingWindow {
	let inactiveMin = DEFAULT_INACTIVE_MIN;
	let graceSec = DEFAULT_GRACE_SEC;
	try {
		const cfg = JSON.parse(readFileSync(join(nasDir, "waiting-config.json"), "utf8")) as {
			inactiveMinutes?: unknown;
			activeGraceSeconds?: unknown;
		};
		const m = Number(cfg.inactiveMinutes);
		if (Number.isFinite(m) && m > 0) {
			inactiveMin = m;
		}
		const g = Number(cfg.activeGraceSeconds);
		if (Number.isFinite(g) && g >= 0) {
			graceSec = g;
		}
	} catch {
		// missing / unreadable / invalid → defaults
	}
	return { recentMs: inactiveMin * 60 * 1000, graceMs: graceSec * 1000 };
}
