import { createHash, randomBytes } from "node:crypto";

import { API, OAUTH } from "./config";

/** Base64url-encode a buffer (no padding). */
function b64url(buf: Buffer): string {
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type Pkce = {
	verifier: string;
	challenge: string;
	state: string;
};

/** Generate a PKCE verifier/challenge pair and an anti-forgery state. */
export function createPkce(): Pkce {
	const verifier = b64url(randomBytes(32));
	const challenge = b64url(createHash("sha256").update(verifier).digest());
	const state = b64url(randomBytes(24));
	return { verifier, challenge, state };
}

/** Build the browser authorize URL for a given PKCE challenge. */
export function buildAuthorizeUrl(pkce: Pkce): string {
	const url = new URL(OAUTH.authorizeUrl);
	url.searchParams.set("code", "true");
	url.searchParams.set("client_id", OAUTH.clientId);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("redirect_uri", OAUTH.redirectUri);
	url.searchParams.set("scope", OAUTH.scopes);
	url.searchParams.set("code_challenge", pkce.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", pkce.state);
	return url.toString();
}

/** Raw token response shape returned by the token endpoint. */
export type TokenResponse = {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope?: string;
	account?: { uuid: string; email_address: string };
	organization?: { uuid: string; name: string };
};

/**
 * Exchange an authorization code (the pasted `code#state` value) for tokens.
 * The verifier from the same {@link Pkce} used to build the authorize URL is required.
 */
export async function exchangeCode(rawCode: string, pkce: Pkce): Promise<TokenResponse> {
	const [code, statePart] = rawCode.trim().split("#");
	const body = {
		grant_type: "authorization_code",
		code,
		state: statePart || pkce.state,
		client_id: OAUTH.clientId,
		redirect_uri: OAUTH.redirectUri,
		code_verifier: pkce.verifier,
	};
	return postToken(body);
}

/**
 * Refresh an access token. The token endpoint ROTATES the refresh token, so the
 * caller must persist the new `refresh_token` from the response.
 */
export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
	return postToken({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: OAUTH.clientId,
	});
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
	const res = await fetch(OAUTH.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Token request failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
	}
	const json = JSON.parse(text) as TokenResponse;
	if (!json.access_token) {
		throw new Error(`Token request returned no access_token: ${text.slice(0, 300)}`);
	}
	return json;
}

/** Fetch the account/org profile for labeling a logged-in account. */
export type Profile = {
	account: { uuid: string; email: string; full_name?: string; has_claude_max?: boolean; has_claude_pro?: boolean };
	organization: { uuid: string; name: string; organization_type?: string };
};

export async function fetchProfile(accessToken: string): Promise<Profile> {
	const res = await fetch(API.profileUrl, {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(`Profile request failed (HTTP ${res.status})`);
	}
	return (await res.json()) as Profile;
}
