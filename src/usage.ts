import streamDeck from "@elgato/streamdeck";

import { getValidAccessToken, loadAccounts } from "./accounts";
import { API, USAGE_BACKOFF_MAX_MS, USAGE_BACKOFF_MIN_MS, USAGE_INTERVAL_MS, USAGE_TICK_MS } from "./config";

/** Error carrying HTTP status + optional Retry-After so the poller can back off. */
class UsageHttpError extends Error {
	constructor(
		readonly status: number,
		readonly retryAfterMs?: number,
	) {
		super(`Usage request failed (HTTP ${status})`);
	}
}

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
		const header = res.headers.get("retry-after");
		const retryAfterMs = header ? Number(header) * 1000 : undefined;
		throw new UsageHttpError(res.status, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined);
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

type AccountState = {
	snapshot?: UsageSnapshot;
	error?: string;
	/** Earliest epoch ms this account may be fetched again. */
	nextDueAt: number;
	/** Current backoff after consecutive 429s; 0 when healthy. */
	backoffMs: number;
};

/**
 * Polls usage per account on a slow base cadence, with exponential backoff on
 * HTTP 429 (honoring Retry-After) so we stay a good API citizen. Accounts are
 * fetched sequentially and each keeps its last-good snapshot through errors.
 */
class UsagePoller {
	private states = new Map<string, AccountState>();
	private listeners = new Set<Listener>();
	private timer?: NodeJS.Timeout;

	getSnapshot(uuid: string): UsageSnapshot | undefined {
		return this.states.get(uuid)?.snapshot;
	}

	getError(uuid: string): string | undefined {
		return this.states.get(uuid)?.error;
	}

	onUpdate(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	start(): void {
		if (this.timer) {
			return;
		}
		void this.tick();
		this.timer = setInterval(() => void this.tick(), USAGE_TICK_MS);
	}

	/** Force an immediate poll of a specific account (e.g. right after login). */
	async pollAccount(uuid: string): Promise<void> {
		await this.fetchOne(uuid);
		this.notify();
	}

	/** Fetch any accounts that are due, sequentially. */
	private async tick(): Promise<void> {
		const accounts = await loadAccounts();
		const now = Date.now();
		let changed = false;
		for (const acc of accounts) {
			const state = this.states.get(acc.uuid);
			if (state && now < state.nextDueAt) {
				continue;
			}
			await this.fetchOne(acc.uuid);
			changed = true;
		}
		if (changed) {
			this.notify();
		}
	}

	private async fetchOne(uuid: string): Promise<void> {
		const state = this.states.get(uuid) ?? { nextDueAt: 0, backoffMs: 0 };
		try {
			state.snapshot = await fetchUsage(uuid);
			state.error = undefined;
			state.backoffMs = 0;
			state.nextDueAt = Date.now() + USAGE_INTERVAL_MS;
			streamDeck.logger.debug(`Usage OK for ${uuid}: session ${state.snapshot.sessionPct}% weekly ${state.snapshot.weeklyPct}%`);
		} catch (err) {
			const status = err instanceof UsageHttpError ? err.status : undefined;
			state.error = err instanceof Error ? err.message : String(err);
			if (status === 429) {
				const retryAfter = err instanceof UsageHttpError ? err.retryAfterMs : undefined;
				state.backoffMs = Math.min(USAGE_BACKOFF_MAX_MS, Math.max(state.backoffMs * 2, USAGE_BACKOFF_MIN_MS));
				state.nextDueAt = Date.now() + Math.max(retryAfter ?? 0, state.backoffMs);
				streamDeck.logger.warn(`Usage 429 for ${uuid}; backing off ${Math.round((state.nextDueAt - Date.now()) / 1000)}s`);
			} else {
				// Transient error — retry at the normal cadence, keep last-good snapshot.
				state.nextDueAt = Date.now() + USAGE_INTERVAL_MS;
				streamDeck.logger.warn(`Usage poll failed for ${uuid}: ${state.error}`);
			}
		}
		this.states.set(uuid, state);
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
