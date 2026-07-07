import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_INACTIVE_MIN = 60;

/**
 * Reads the "inactive after N minutes" window from `<nasDir>/waiting-config.json`,
 * shared by the plugin and all machine reporters. Re-read each cycle so edits apply
 * with no restart. Falls back to 60 minutes when the file is missing or invalid.
 */
export function readInactiveMs(nasDir: string): number {
	try {
		const cfg = JSON.parse(readFileSync(join(nasDir, "waiting-config.json"), "utf8")) as { inactiveMinutes?: unknown };
		const m = Number(cfg.inactiveMinutes);
		if (Number.isFinite(m) && m > 0) {
			return m * 60 * 1000;
		}
	} catch {
		// missing / unreadable / invalid → default
	}
	return DEFAULT_INACTIVE_MIN * 60 * 1000;
}
