import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const DEFAULT_INACTIVE_MIN = 60;
const DEFAULT_GRACE_SEC = 120;

export type WaitingWindow = {
	/** Upper bound: sessions idle longer than this stop counting (abandoned). */
	recentMs: number;
	/** Lower bound: sessions idle less than this are still mid-generation (excluded). */
	graceMs: number;
};

/**
 * Normalize the configured NAS path to the shared root, tolerating a value that
 * already includes the `reports` subfolder (a common mis-entry). Reports live in
 * `<root>/reports` and waiting-config.json in `<root>`.
 */
export function nasRoot(nasDir: string): string {
	return basename(nasDir).toLowerCase() === "reports" ? dirname(nasDir) : nasDir;
}

/**
 * Reads the waiting window from `<nasDir>/waiting-config.json`, shared by the plugin
 * and all machine reporters. Re-read each cycle so edits apply with no restart. Falls
 * back to defaults (inactive 60 min, grace 120 s) when the file is missing or invalid.
 */
export function readWaitingWindow(nasDir: string): WaitingWindow {
	let inactiveMin = DEFAULT_INACTIVE_MIN;
	let graceSec = DEFAULT_GRACE_SEC;
	try {
		const cfg = JSON.parse(readFileSync(join(nasRoot(nasDir), "waiting-config.json"), "utf8")) as {
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
