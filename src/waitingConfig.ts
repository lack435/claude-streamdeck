import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const DEFAULT_INACTIVE_MIN = 60;

/**
 * Normalize the configured NAS path to the shared root, tolerating a value that
 * already includes the `reports` subfolder (a common mis-entry). Reports live in
 * `<root>/reports` and waiting-config.json in `<root>`.
 */
export function nasRoot(nasDir: string): string {
	return basename(nasDir).toLowerCase() === "reports" ? dirname(nasDir) : nasDir;
}

/**
 * Reads the "inactive after N minutes" window from `<nasDir>/waiting-config.json`,
 * shared by the plugin and all machine reporters. Re-read each cycle so edits apply
 * with no restart. Falls back to 60 minutes when the file is missing or invalid.
 */
export function readInactiveMs(nasDir: string): number {
	try {
		const cfg = JSON.parse(readFileSync(join(nasRoot(nasDir), "waiting-config.json"), "utf8")) as { inactiveMinutes?: unknown };
		const m = Number(cfg.inactiveMinutes);
		if (Number.isFinite(m) && m > 0) {
			return m * 60 * 1000;
		}
	} catch {
		// missing / unreadable / invalid → default
	}
	return DEFAULT_INACTIVE_MIN * 60 * 1000;
}
