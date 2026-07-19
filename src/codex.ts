/**
 * OAuth for OpenAI Codex (ChatGPT-plan) accounts, mirroring what the Codex CLI
 * does: PKCE against auth.openai.com with its public client id. Notable quirks
 * (from the CLI source): the code exchange is form-encoded but the refresh
 * grant is JSON, and the refresh token ROTATES with reuse detection — the new
 * one must be persisted every time.
 */

import { CODEX_OAUTH } from "./config";
import type { Pkce } from "./oauth";

/** Token response from auth.openai.com (both exchange and refresh). */
export type CodexTokens = {
	id_token?: string;
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
};

/** Decode a JWT payload without verifying (we only read our own tokens' claims). */
function decodeJwt(token: string): Record<string, unknown> {
	const payload = token.split(".")[1] ?? "";
	const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
	return JSON.parse(json) as Record<string, unknown>;
}

/** Build the browser authorize URL, matching the Codex CLI's parameters. */
export function buildCodexAuthorizeUrl(pkce: Pkce): string {
	const url = new URL(CODEX_OAUTH.authorizeUrl);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CODEX_OAUTH.clientId);
	url.searchParams.set("redirect_uri", CODEX_OAUTH.redirectUri);
	url.searchParams.set("scope", CODEX_OAUTH.scopes);
	url.searchParams.set("code_challenge", pkce.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", pkce.state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	return url.toString();
}

/** Exchange an authorization code from the localhost callback for tokens (form-encoded). */
export async function exchangeCodexCode(code: string, pkce: Pkce): Promise<CodexTokens> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		redirect_uri: CODEX_OAUTH.redirectUri,
		client_id: CODEX_OAUTH.clientId,
		code_verifier: pkce.verifier,
	});
	return postCodexToken(body.toString(), "application/x-www-form-urlencoded");
}

/** Refresh an access token (JSON grant; the refresh token rotates — persist the new one). */
export async function refreshCodexTokens(refreshToken: string): Promise<CodexTokens> {
	const body = JSON.stringify({
		client_id: CODEX_OAUTH.clientId,
		grant_type: "refresh_token",
		refresh_token: refreshToken,
	});
	return postCodexToken(body, "application/json");
}

async function postCodexToken(body: string, contentType: string): Promise<CodexTokens> {
	const res = await fetch(CODEX_OAUTH.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": contentType, Accept: "application/json" },
		body,
		signal: AbortSignal.timeout(15_000),
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Codex token request failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
	}
	const json = JSON.parse(text) as CodexTokens;
	if (!json.access_token) {
		throw new Error(`Codex token request returned no access_token: ${text.slice(0, 300)}`);
	}
	return json;
}

/** Who this token belongs to, read from the JWT claims. */
export type CodexIdentity = {
	accountId: string;
	email: string;
	plan?: string;
};

/** Extract the ChatGPT account id / email / plan from the id or access token. */
export function codexIdentity(tokens: CodexTokens): CodexIdentity {
	let claims: Record<string, unknown> = {};
	for (const token of [tokens.id_token, tokens.access_token]) {
		if (!token) {
			continue;
		}
		try {
			claims = { ...decodeJwt(token), ...claims };
		} catch {
			// Tolerate a non-JWT token; the other one may still carry the claims.
		}
	}
	const auth = (claims["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
	const profile = (claims["https://api.openai.com/profile"] ?? {}) as Record<string, unknown>;
	const accountId = String(auth.chatgpt_account_id ?? claims.chatgpt_account_id ?? "");
	const email = String(profile.email ?? claims.email ?? "");
	const planType = auth.chatgpt_plan_type;
	const plan = typeof planType === "string" && planType ? planType[0].toUpperCase() + planType.slice(1) : undefined;
	if (!accountId) {
		throw new Error("Codex login succeeded but no chatgpt_account_id claim was found in the tokens.");
	}
	return { accountId, email, plan };
}

/** Epoch ms when the access token expires (JWT `exp`, falling back to expires_in). */
export function codexTokenExpiry(tokens: CodexTokens): number {
	try {
		const exp = decodeJwt(tokens.access_token).exp;
		if (typeof exp === "number") {
			return exp * 1000;
		}
	} catch {
		// Fall through to expires_in.
	}
	return Date.now() + (tokens.expires_in ?? 3600) * 1000;
}
