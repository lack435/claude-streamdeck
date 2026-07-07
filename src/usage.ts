import streamDeck from "@elgato/streamdeck";

import { getValidAccessToken, loadAccounts } from "./accounts";
import { API, POLL_INTERVAL_MS } from "./config";

/** Normalized usage snapshot for one account. */
export type UsageSnapshot = {
	sessionPct: number;
	weeklyPct: number;
	sessionResetsAt?: string;
	weeklyResetsAt?: string;
	sessionSeverity?: string;
	weeklySeverity?: string;
	fetchedAt: number;
};

type UsageLimit = { kind?: string; group?: string; percent?: number; severity?: string; resets_at?: string };
type UsageResponse = {
	five_hour?: { utilization?: number; resets_at?: string };
	seven_day?: { utilization?: number; resets_at?: string };
	limits?: UsageLimit[];
};

/** Fetch and normalize usage for a single account. */
export async function fetchUsage(uuid: string): Promise<UsageSnapshot> {
	const token = await getValidAccessToken(uuid);
	const res = await fetch(API.usageUrl, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(`Usage request failed (HTTP ${res.status})`);
	}
	const data = (await res.json()) as UsageResponse;
	const limits = data.limits ?? [];
	const session = limits.find((l) => l.kind === "session");
	const weekly = limits.find((l) => l.kind === "weekly_all") ?? limits.find((l) => l.group === "weekly");
	return {
		sessionPct: Math.round(data.five_hour?.utilization ?? session?.percent ?? 0),
		weeklyPct: Math.round(data.seven_day?.utilization ?? weekly?.percent ?? 0),
		sessionResetsAt: data.five_hour?.resets_at ?? session?.resets_at,
		weeklyResetsAt: data.seven_day?.resets_at ?? weekly?.resets_at,
		sessionSeverity: session?.severity,
		weeklySeverity: weekly?.severity,
		fetchedAt: Date.now(),
	};
}

type Listener = () => void;

/**
 * Polls usage for all logged-in accounts on an interval and caches the latest
 * snapshot (or error) per account. Actions subscribe via {@link onUpdate}.
 */
class UsagePoller {
	private snapshots = new Map<string, UsageSnapshot>();
	private errors = new Map<string, string>();
	private listeners = new Set<Listener>();
	private timer?: NodeJS.Timeout;

	getSnapshot(uuid: string): UsageSnapshot | undefined {
		return this.snapshots.get(uuid);
	}

	getError(uuid: string): string | undefined {
		return this.errors.get(uuid);
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
		this.timer = setInterval(() => void this.pollNow(), POLL_INTERVAL_MS);
	}

	/** Poll every logged-in account once and notify listeners. */
	async pollNow(): Promise<void> {
		const accounts = await loadAccounts();
		await Promise.all(
			accounts.map(async (acc) => {
				try {
					this.snapshots.set(acc.uuid, await fetchUsage(acc.uuid));
					this.errors.delete(acc.uuid);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					this.errors.set(acc.uuid, message);
					streamDeck.logger.warn(`Usage poll failed for ${acc.email}: ${message}`);
				}
			}),
		);
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (err) {
				streamDeck.logger.error("Usage listener threw", err);
			}
		}
	}
}

export const poller = new UsagePoller();
