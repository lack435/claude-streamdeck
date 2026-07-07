import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MINUTES = 60;

/**
 * Reads the "inactive after N minutes" threshold from `<nasDir>/waiting-config.json`
 * (shared by the plugin and all machine reporters). Falls back to 60 minutes if the
 * file is missing or invalid. Read fresh on each poll so edits take effect without
 * restarting anything.
 */
export function readInactiveMs(nasDir: string): number {
	try {
		const cfg = JSON.parse(readFileSync(join(nasDir, "waiting-config.json"), "utf8")) as { inactiveMinutes?: unknown };
		const minutes = Number(cfg.inactiveMinutes);
		if (Number.isFinite(minutes) && minutes > 0) {
			return minutes * 60 * 1000;
		}
	} catch {
		// missing / unreadable / invalid → default
	}
	return DEFAULT_MINUTES * 60 * 1000;
}
