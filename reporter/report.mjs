#!/usr/bin/env node
// Claude Stream Deck — per-machine reporter.
//
// Run this on EVERY machine (including the one with the Stream Deck — recent Claude
// Code locks down %APPDATA%\Claude so the sandboxed plugin can't read local sessions).
// It writes this machine's "agents waiting for input" counts to the shared NAS folder
// so the plugin can aggregate across machines.
//
// Usage:
//   node report.mjs --out "\\\\NAS\\share\\claude-streamdeck" [--interval 30] [--once]
//   (or set CLAUDE_SD_NAS instead of --out)
//
// Install as a scheduled task / login item so it runs continuously. See README.

import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Normalize the NAS path to the shared root, tolerating a trailing "reports" segment.
const nasRoot = (d) => (basename(d).toLowerCase() === "reports" ? dirname(d) : d);

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

// CLI sessionIds that currently have a live process. A session with a live process is
// actively working/attached (dim); when the agent finishes the process exits, so no
// process = done/idle. This is stable, unlike transcript mtime which has gaps during
// long thinking / tool calls and falsely read active agents as "done".
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

// "Inactive after N minutes" window, shared via <nasDir>/waiting-config.json, re-read
// each cycle so edits apply without re-running anything. Default 60 min.
function readRecentMs() {
	const c = readJson(join(nasRoot(nasDir), "waiting-config.json")) || {};
	const m = Number(c.inactiveMinutes);
	return (Number.isFinite(m) && m > 0 ? m : 60) * 60000;
}

// accountUuid -> count of sessions waiting for your reply on this machine: unarchived,
// not a scheduled routine, with a completed turn, NO live process (done, not actively
// working), and last active within the window (recent, not abandoned). All accounts.
function computeLocalWaiting() {
	const root = join(claudeAppDataDir(), "claude-code-sessions");
	const counts = {};
	if (!existsSync(root)) return counts;
	const now = Date.now();
	const live = liveSessionIds();
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
				if (!s || s.isArchived || s.scheduledTaskId != null) continue;
				if ((s.completedTurns ?? 0) <= 0) continue;
				if (s.cliSessionId && live.has(s.cliSessionId)) continue; // actively working
				if (now - (s.lastActivityAt ?? 0) <= recentMs) waiting++;
			}
		}
		counts[accountId] = waiting;
	}
	return counts;
}

function writeReport() {
	const machine = (hostname() || "machine").replace(/[^a-zA-Z0-9_.-]/g, "_");
	const accounts = computeLocalWaiting();
	// An empty map means the sessions folder couldn't be read (blocked/not ready) —
	// a real machine always has >=1 account dir, reported as 0. Skip so we never clobber
	// a previously-good report with {} (as a bad early-boot instance once did).
	if (Object.keys(accounts).length === 0) {
		console.log(`[${new Date().toISOString()}] ${machine}: no readable sessions, skipping write`);
		return;
	}
	const dir = join(nasRoot(nasDir), "reports");
	mkdirSync(dir, { recursive: true });
	const report = { machine, updatedAt: Date.now(), accounts };
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
