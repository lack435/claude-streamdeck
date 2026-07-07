import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Computes, per account, how many Claude Code agent sessions on THIS machine are
 * "waiting for input" — i.e. unarchived and not currently running.
 *
 * Sources (local, per-machine; see docs/spike-findings.md):
 *  - Roster:  <ClaudeAppData>/claude-code-sessions/<accountUuid>/<orgUuid>/local_*.json
 *             (fields: isArchived, cliSessionId, lastActivityAt, lastFocusedAt)
 *  - Running: ~/.claude/sessions/<pid>.json (fields: pid, sessionId) — a desktop
 *             session is running iff its cliSessionId matches a live process's sessionId.
 */

/** Directory where the Claude desktop app stores its data, per platform. */
function claudeAppDataDir(): string {
	if (process.platform === "win32") {
		return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude");
	}
	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Application Support", "Claude");
	}
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Claude");
}

function readJson<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means the process exists but we can't signal it — still alive.
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Set of CLI sessionIds that belong to a currently-running process. */
function liveSessionIds(): Set<string> {
	const dir = join(homedir(), ".claude", "sessions");
	const live = new Set<string>();
	if (!existsSync(dir)) {
		return live;
	}
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".json")) {
			continue;
		}
		const d = readJson<{ pid?: number; sessionId?: string }>(join(dir, file));
		if (d?.pid && d.sessionId && pidAlive(d.pid)) {
			live.add(d.sessionId);
		}
	}
	return live;
}

type DesktopSession = {
	isArchived?: boolean;
	cliSessionId?: string;
	lastActivityAt?: number;
	completedTurns?: number;
	/** Present when the session was spawned by a scheduled task / routine — never counted. */
	scheduledTaskId?: string;
};

/** Defaults when no shared config is present. */
const DEFAULT_RECENT_MS = 60 * 60 * 1000;
const DEFAULT_GRACE_MS = 180 * 1000;

/**
 * Returns a map of accountUuid → count of sessions waiting for your reply on this
 * machine: unarchived, not actively running, with at least one completed turn
 * (excludes headless/scheduled runs), and active within {@link recentMs}. Counted
 * across all accounts, not just the signed-in one.
 *
 * "Actively running" = a live process with activity in the last {@link graceMs};
 * a lingering process with stale activity is treated as idle/waiting, which works
 * around Claude Code's stuck-"Running" state.
 */
export function computeLocalWaiting(recentMs: number = DEFAULT_RECENT_MS, graceMs: number = DEFAULT_GRACE_MS): Record<string, number> {
	const root = join(claudeAppDataDir(), "claude-code-sessions");
	const counts: Record<string, number> = {};
	if (!existsSync(root)) {
		return counts;
	}
	const live = liveSessionIds();
	const now = Date.now();

	for (const accountId of readdirSync(root)) {
		const accDir = join(root, accountId);
		if (!statSync(accDir).isDirectory()) {
			continue;
		}
		let waiting = 0;
		for (const orgId of readdirSync(accDir)) {
			const orgDir = join(accDir, orgId);
			if (!statSync(orgDir).isDirectory()) {
				continue;
			}
			for (const file of readdirSync(orgDir)) {
				if (!file.startsWith("local_") || !file.endsWith(".json")) {
					continue;
				}
				const s = readJson<DesktopSession>(join(orgDir, file));
				if (!s || s.isArchived) {
					continue;
				}
				if (s.scheduledTaskId != null) {
					continue; // scheduled task / routine — not something awaiting your reply
				}
				const age = now - (s.lastActivityAt ?? 0);
				const running = !!s.cliSessionId && live.has(s.cliSessionId) && age < graceMs;
				const real = (s.completedTurns ?? 0) > 0;
				const recent = age <= recentMs;
				if (!running && real && recent) {
					waiting++;
				}
			}
		}
		counts[accountId] = waiting;
	}
	return counts;
}
