/**
 * Static configuration for the plugin. OAuth values are the public Claude Code
 * client, reused for interop with the user's own accounts (see docs/spike-findings.md).
 */
export const OAUTH = {
	clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
	authorizeUrl: "https://claude.com/cai/oauth/authorize",
	tokenUrl: "https://platform.claude.com/v1/oauth/token",
	redirectUri: "https://platform.claude.com/oauth/code/callback",
	scopes: "org:create_api_key user:profile user:inference user:sessions:claude_code",
} as const;

export const API = {
	usageUrl: "https://api.anthropic.com/api/oauth/usage",
	profileUrl: "https://api.anthropic.com/api/oauth/profile",
} as const;

/** How often to refresh usage from the API, in milliseconds. */
export const POLL_INTERVAL_MS = 45_000;

/** Refresh the access token this many ms before it actually expires. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;
