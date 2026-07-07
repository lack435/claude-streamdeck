import streamDeck from "@elgato/streamdeck";

import { TOKEN_REFRESH_SKEW_MS } from "./config";
import { fetchProfile, refreshTokens, type TokenResponse } from "./oauth";

/** A logged-in account persisted in the plugin's global settings. */
export type StoredAccount = {
	uuid: string;
	email: string;
	label: string;
	plan?: string;
	orgName?: string;
	accessToken: string;
	refreshToken: string;
	/** Epoch ms when the access token expires. */
	expiresAt: number;
};

export type GlobalSettings = {
	accounts?: StoredAccount[];
	/** Milestone 2: shared NAS folder for cross-machine agent aggregation. */
	nasPath?: string;
};

// In-memory cache so rendering/polling doesn't round-trip to Stream Deck settings.
let cache: StoredAccount[] | null = null;

async function getGlobal(): Promise<GlobalSettings> {
	return (await streamDeck.settings.getGlobalSettings<GlobalSettings>()) ?? {};
}

async function setGlobal(next: GlobalSettings): Promise<void> {
	cache = next.accounts ?? [];
	await streamDeck.settings.setGlobalSettings(next);
}

export async function loadAccounts(force = false): Promise<StoredAccount[]> {
	if (cache === null || force) {
		cache = (await getGlobal()).accounts ?? [];
	}
	return cache;
}

/** Synchronous access to the last-loaded accounts (empty until {@link loadAccounts} warms the cache). */
export function getCachedAccounts(): StoredAccount[] {
	return cache ?? [];
}

export function getCachedAccount(uuid: string): StoredAccount | undefined {
	return (cache ?? []).find((a) => a.uuid === uuid);
}

export async function getAccount(uuid: string): Promise<StoredAccount | undefined> {
	return (await loadAccounts()).find((a) => a.uuid === uuid);
}

/** Persist (insert or replace) an account by uuid. */
async function upsertAccount(acc: StoredAccount): Promise<void> {
	const global = await getGlobal();
	const accounts = (global.accounts ?? []).filter((a) => a.uuid !== acc.uuid);
	accounts.push(acc);
	await setGlobal({ ...global, accounts });
}

export async function removeAccount(uuid: string): Promise<void> {
	const global = await getGlobal();
	await setGlobal({ ...global, accounts: (global.accounts ?? []).filter((a) => a.uuid !== uuid) });
}

/** Build a {@link StoredAccount} from a fresh token response, enriching with profile info. */
export async function accountFromToken(tokens: TokenResponse): Promise<StoredAccount> {
	const uuid = tokens.account?.uuid ?? "";
	let email = tokens.account?.email_address ?? "";
	let plan: string | undefined;
	let orgName = tokens.organization?.name;
	try {
		const profile = await fetchProfile(tokens.access_token);
		email = profile.account.email || email;
		orgName = profile.organization?.name ?? orgName;
		plan = profile.account.has_claude_max ? "Max" : profile.account.has_claude_pro ? "Pro" : profile.organization?.organization_type;
	} catch (err) {
		streamDeck.logger.warn("Could not fetch profile for account label", err);
	}
	const acc: StoredAccount = {
		uuid,
		email,
		label: email || uuid,
		plan,
		orgName,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt: Date.now() + tokens.expires_in * 1000,
	};
	await upsertAccount(acc);
	return acc;
}

// De-dupe concurrent refreshes for the same account.
const pendingRefreshes = new Map<string, Promise<string>>();

/**
 * Return a valid access token for the account, refreshing (and persisting the
 * rotated refresh token) if it is expired or about to expire.
 */
export async function getValidAccessToken(uuid: string): Promise<string> {
	const acc = await getAccount(uuid);
	if (!acc) {
		throw new Error(`No logged-in account with uuid ${uuid}`);
	}
	if (Date.now() < acc.expiresAt - TOKEN_REFRESH_SKEW_MS) {
		return acc.accessToken;
	}
	const inflight = pendingRefreshes.get(uuid);
	if (inflight) {
		return inflight;
	}
	const promise = (async () => {
		streamDeck.logger.info(`Refreshing access token for ${acc.email}`);
		const tokens = await refreshTokens(acc.refreshToken);
		const updated: StoredAccount = {
			...acc,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token ?? acc.refreshToken,
			expiresAt: Date.now() + tokens.expires_in * 1000,
		};
		await upsertAccount(updated);
		return updated.accessToken;
	})().finally(() => pendingRefreshes.delete(uuid));
	pendingRefreshes.set(uuid, promise);
	return promise;
}
