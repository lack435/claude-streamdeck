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
	/** 0/absent means the session was never opened in the app — i.e. a headless/scheduled run. */
	lastFocusedAt?: number;
};

/**
 * The account currently signed into the desktop app on this machine. Sessions
 * under other accounts are stale leftovers from a previous login (you can't act
 * on them without switching accounts), so we don't count them.
 */
function activeAccountId(): string | undefined {
	const cfg = readJson<{ lastKnownAccountUuid?: string }>(join(claudeAppDataDir(), "config.json"));
	return cfg?.lastKnownAccountUuid;
}

/** Returns a map of accountUuid → count of sessions waiting for input on this machine. */
export function computeLocalWaiting(): Record<string, number> {
	const root = join(claudeAppDataDir(), "claude-code-sessions");
	const counts: Record<string, number> = {};
	if (!existsSync(root)) {
		return counts;
	}
	const live = liveSessionIds();
	const active = activeAccountId();

	for (const accountId of readdirSync(root)) {
		// Only the currently-signed-in account is actionable; skip stale accounts.
		if (active && accountId !== active) {
			continue;
		}
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
				const running = !!s.cliSessionId && live.has(s.cliSessionId);
				// Only count sessions you've actually opened and are awaiting your reply:
				// unarchived, not running, and focused at least once (excludes headless/scheduled runs).
				const opened = (s.lastFocusedAt ?? 0) > 0;
				if (!running && opened) {
					waiting++;
				}
			}
		}
		counts[accountId] = waiting;
	}
	return counts;
}
