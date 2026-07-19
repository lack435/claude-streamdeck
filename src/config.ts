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

/**
 * OpenAI Codex CLI's public OAuth client (PKCE, no secret). The redirect URI is
 * fixed at localhost:1455, so login runs a short-lived local HTTP server to
 * catch the callback instead of the paste-a-code flow used for Claude.
 */
export const CODEX_OAUTH = {
	clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
	authorizeUrl: "https://auth.openai.com/oauth/authorize",
	tokenUrl: "https://auth.openai.com/oauth/token",
	redirectUri: "http://localhost:1455/auth/callback",
	redirectPort: 1455,
	scopes: "openid profile email offline_access",
} as const;

export const CODEX_API = {
	/** Rate-limit windows for ChatGPT-plan Codex (primary = 5h, secondary = weekly). */
	usageUrl: "https://chatgpt.com/backend-api/wham/usage",
} as const;

/** Give up on a pending Codex browser login after this long. */
export const CODEX_LOGIN_TIMEOUT_MS = 5 * 60_000;

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
