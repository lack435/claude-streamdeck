import streamDeck from "@elgato/streamdeck";

import { getCachedNasPath } from "./accounts";
import { AGENT_POLL_INTERVAL_MS, AGENT_STALE_MS } from "./config";
import { readAggregate, writeLocalReport, type Aggregate } from "./nas";

type Listener = () => void;

/**
 * On an interval: writes this machine's waiting-agent counts to the shared NAS
 * folder, then reads every machine's report and aggregates per account. Actions
 * subscribe via {@link onUpdate}. No-op until a NAS path is configured.
 */
class AgentPoller {
	private aggregate: Aggregate = { counts: {}, machinesFresh: 0, machinesStale: 0 };
	private lastError?: string;
	private listeners = new Set<Listener>();
	private timer?: NodeJS.Timeout;

	/** Waiting count for an account, or undefined if not configured / unknown. */
	getCount(accountUuid: string): number | undefined {
		if (!getCachedNasPath()) {
			return undefined;
		}
		return this.aggregate.counts[accountUuid] ?? 0;
	}

	getError(): string | undefined {
		return this.lastError;
	}

	isConfigured(): boolean {
		return !!getCachedNasPath();
	}

	onUpdate(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	start(): void {
		if (this.timer) {
			return;
		}
		void this.pollNow();
		this.timer = setInterval(() => void this.pollNow(), AGENT_POLL_INTERVAL_MS);
	}

	/** Report this machine and re-read the aggregate. */
	async pollNow(): Promise<void> {
		const nasPath = getCachedNasPath();
		if (!nasPath) {
			this.notify();
			return;
		}
		try {
			writeLocalReport(nasPath);
			this.aggregate = readAggregate(nasPath, AGENT_STALE_MS);
			this.lastError = undefined;
		} catch (err) {
			this.lastError = err instanceof Error ? err.message : String(err);
			streamDeck.logger.warn(`Agent NAS poll failed: ${this.lastError}`);
		}
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (err) {
				streamDeck.logger.error("Agent listener threw", err);
			}
		}
	}
}

export const agentPoller = new AgentPoller();
