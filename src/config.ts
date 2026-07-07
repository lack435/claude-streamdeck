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

/** Base cadence for refreshing usage per account (usage windows move slowly). */
export const USAGE_INTERVAL_MS = 180_000;

/** Scheduler granularity — how often the poller checks whether any account is due. */
export const USAGE_TICK_MS = 15_000;

/** Backoff bounds applied when the usage endpoint returns 429. */
export const USAGE_BACKOFF_MIN_MS = 60_000;
export const USAGE_BACKOFF_MAX_MS = 20 * 60_000;

/** How often to report this machine's agent state to the NAS and re-aggregate. */
export const AGENT_POLL_INTERVAL_MS = 20_000;

/** Machine reports older than this are treated as offline and excluded from the aggregate. */
export const AGENT_STALE_MS = 120_000;

/** Refresh the access token this many ms before it actually expires. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;
