import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { computeLocalWaiting } from "./localSessions";
import { readWaitingWindow } from "./waitingConfig";

/** One machine's contribution, written to `<nas>/reports/<machine>.json`. */
export type MachineReport = {
	machine: string;
	updatedAt: number;
	/** accountUuid → number of sessions waiting for input on that machine. */
	accounts: Record<string, number>;
};

export type Aggregate = {
	/** accountUuid → summed waiting count across fresh machines. */
	counts: Record<string, number>;
	machinesFresh: number;
	machinesStale: number;
};

/** Filesystem-safe machine name for use as a filename. */
function machineName(): string {
	return (hostname() || "machine").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function reportsDir(nasDir: string): string {
	return join(nasDir, "reports");
}

/** Compute this machine's waiting counts and write them to the NAS atomically. */
export function writeLocalReport(nasDir: string): MachineReport {
	const dir = reportsDir(nasDir);
	mkdirSync(dir, { recursive: true });
	const { recentMs, graceMs } = readWaitingWindow(nasDir);
	const report: MachineReport = {
		machine: machineName(),
		updatedAt: Date.now(),
		accounts: computeLocalWaiting(recentMs, graceMs),
	};
	const target = join(dir, `${report.machine}.json`);
	const tmp = `${target}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(report));
	renameSync(tmp, target); // atomic replace on same filesystem
	return report;
}

/**
 * Read every machine report and sum waiting counts per account, ignoring reports
 * older than {@link staleMs} (machines that are off / not reporting).
 */
export function readAggregate(nasDir: string, staleMs: number): Aggregate {
	const dir = reportsDir(nasDir);
	const agg: Aggregate = { counts: {}, machinesFresh: 0, machinesStale: 0 };
	if (!existsSync(dir)) {
		return agg;
	}
	const now = Date.now();
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".json")) {
			continue;
		}
		let report: MachineReport;
		try {
			report = JSON.parse(readFileSync(join(dir, file), "utf8")) as MachineReport;
		} catch {
			continue;
		}
		if (!report?.accounts || typeof report.updatedAt !== "number") {
			continue;
		}
		if (now - report.updatedAt > staleMs) {
			agg.machinesStale++;
			continue;
		}
		agg.machinesFresh++;
		for (const [uuid, count] of Object.entries(report.accounts)) {
			agg.counts[uuid] = (agg.counts[uuid] ?? 0) + (count ?? 0);
		}
	}
	return agg;
}
