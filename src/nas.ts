import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { nasRoot } from "./waitingConfig";

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
	/** Per fresh machine: its total waiting count across all accounts. */
	machines: MachineWaiting[];
	machinesFresh: number;
	machinesStale: number;
};

export type MachineWaiting = {
	name: string;
	waiting: number;
};

function reportsDir(nasDir: string): string {
	return join(nasRoot(nasDir), "reports");
}

/**
 * Read every machine report and sum waiting counts per account, ignoring reports
 * older than {@link staleMs} (machines that are off / not reporting).
 *
 * NOTE: the plugin does NOT write its own report — recent Claude Code locks down
 * %APPDATA%\Claude so the sandboxed plugin process can't read local sessions. Every
 * machine (including this one) runs the standalone reporter, which runs as a normal
 * process and can read them; the plugin only aggregates.
 */
export function readAggregate(nasDir: string, staleMs: number): Aggregate {
	const dir = reportsDir(nasDir);
	const agg: Aggregate = { counts: {}, machines: [], machinesFresh: 0, machinesStale: 0 };
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
		let machineTotal = 0;
		for (const [uuid, count] of Object.entries(report.accounts)) {
			agg.counts[uuid] = (agg.counts[uuid] ?? 0) + (count ?? 0);
			machineTotal += count ?? 0;
		}
		agg.machines.push({ name: report.machine, waiting: machineTotal });
	}
	agg.machines.sort((a, b) => a.name.localeCompare(b.name));
	return agg;
}
