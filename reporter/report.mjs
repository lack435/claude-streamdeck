#!/usr/bin/env node
// Claude Stream Deck — per-machine reporter.
//
// Run this on every machine EXCEPT the one running the Stream Deck plugin (that
// machine reports itself). It writes this machine's "agents waiting for input"
// counts to the shared NAS folder so the plugin can aggregate across machines.
//
// Usage:
//   node report.mjs --out "\\\\NAS\\share\\claude-streamdeck" [--interval 30] [--once]
//   (or set CLAUDE_SD_NAS instead of --out)
//
// Install as a scheduled task / login item so it runs continuously. See README.

import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const getArg = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

// When this script lives in <NAS>/reporter/report.mjs, default the output to the
// NAS root (its parent) so it can be run with no arguments straight from the share.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultOut = dirname(scriptDir);
const nasDir = getArg("--out") || process.env.CLAUDE_SD_NAS || defaultOut;
const intervalSec = Number(getArg("--interval") || 30);
const once = args.includes("--once");

function claudeAppDataDir() {
	if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude");
	if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Claude");
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Claude");
}

function readJson(path) {
	try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function pidAlive(pid) {
	try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function liveSessionIds() {
	const dir = join(homedir(), ".claude", "sessions");
	const live = new Set();
	if (!existsSync(dir)) return live;
	for (const f of readdirSync(dir)) {
		if (!f.endsWith(".json")) continue;
		const d = readJson(join(dir, f));
		if (d?.pid && d.sessionId && pidAlive(d.pid)) live.add(d.sessionId);
	}
	return live;
}

// "Inactive after N minutes" threshold, shared via <nasDir>/waiting-config.json.
// Re-read each cycle so edits apply without re-running anything. Default 60 min.
function readRecentMs() {
	const c = readJson(join(nasDir, "waiting-config.json"));
	const m = Number(c?.inactiveMinutes);
	return Number.isFinite(m) && m > 0 ? m * 60000 : 60 * 60000;
}

// accountUuid -> count of sessions waiting for your reply on this machine:
// unarchived, not running, with a completed turn (excludes headless/scheduled runs),
// and active within the window. Counted across all accounts, not just the signed-in one.
function computeLocalWaiting() {
	const root = join(claudeAppDataDir(), "claude-code-sessions");
	const counts = {};
	if (!existsSync(root)) return counts;
	const live = liveSessionIds();
	const now = Date.now();
	const recentMs = readRecentMs();
	for (const accountId of readdirSync(root)) {
		const accDir = join(root, accountId);
		if (!statSync(accDir).isDirectory()) continue;
		let waiting = 0;
		for (const orgId of readdirSync(accDir)) {
			const orgDir = join(accDir, orgId);
			if (!statSync(orgDir).isDirectory()) continue;
			for (const f of readdirSync(orgDir)) {
				if (!f.startsWith("local_") || !f.endsWith(".json")) continue;
				const s = readJson(join(orgDir, f));
				if (!s || s.isArchived) continue;
				const running = s.cliSessionId && live.has(s.cliSessionId);
				const real = (s.completedTurns ?? 0) > 0;
				const recent = now - (s.lastActivityAt ?? 0) <= recentMs;
				if (!running && real && recent) waiting++;
			}
		}
		counts[accountId] = waiting;
	}
	return counts;
}

function writeReport() {
	const machine = (hostname() || "machine").replace(/[^a-zA-Z0-9_.-]/g, "_");
	const dir = join(nasDir, "reports");
	mkdirSync(dir, { recursive: true });
	const report = { machine, updatedAt: Date.now(), accounts: computeLocalWaiting() };
	const target = join(dir, `${machine}.json`);
	const tmp = `${target}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(report));
	renameSync(tmp, target);
	const total = Object.values(report.accounts).reduce((a, b) => a + b, 0);
	console.log(`[${new Date().toISOString()}] ${machine}: ${total} waiting across ${Object.keys(report.accounts).length} account(s) -> ${target}`);
}

function tick() {
	try { writeReport(); } catch (e) { console.error("report failed:", e.message); }
}

tick();
if (!once) setInterval(tick, Math.max(5, intervalSec) * 1000);
