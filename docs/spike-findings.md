# Spike findings — Claude Code state sources

Date: 2026-07-06. Goal: determine data sources for a Stream Deck plugin showing,
per account (personal + work): session usage %, weekly usage %, and count of
unarchived agents waiting for input — across multiple machines.

## Verdict

| Metric | Source | Cross-machine? |
|---|---|---|
| Session usage % | `GET /api/oauth/usage` → `five_hour.utilization` | Yes (account-level) |
| Weekly usage % | `GET /api/oauth/usage` → `seven_day.utilization` | Yes (account-level) |
| Agents waiting for input | Local files only (`%APPDATA%\Roaming\Claude\claude-code-sessions`) | **No** — must aggregate via shared NAS folder |

## OAuth (per account)

Claude Code's public OAuth client, reused for interop with the user's own accounts.

- **client_id:** `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- **Authorize (subscription accounts):** `https://claude.com/cai/oauth/authorize`
- **Token / refresh:** `https://platform.claude.com/v1/oauth/token`
- **Redirect:** `https://platform.claude.com/oauth/code/callback` (manual paste — page shows `code#state`, no local server required)
- **Scopes granted:** `user:inference user:profile user:sessions:claude_code` (we request `org:create_api_key` too but it isn't granted for subscription accounts; we don't need it)
- **PKCE:** S256. `code_challenge` from `base64url(sha256(verifier))`.

Token exchange (authorization_code) and refresh (refresh_token) both POST JSON to the token URL with `client_id`. Response:

```
{ token_type, access_token, refresh_token, expires_in: 28800, scope,
  token_uuid, organization: {uuid, name}, account: {uuid, email_address} }
```

- Access token lifetime: **8h**. Refresh works.
- ⚠️ **Refresh token ROTATES** on every refresh — the token store MUST persist the
  newly returned refresh_token or the next refresh fails.
- `account` / `organization` in the response self-label each login (e.g. personal =
  `claude@danwellman.com`, Claude Max). No need to ask the user to name accounts.

## Usage — `GET https://api.anthropic.com/api/oauth/usage`

Auth: `Authorization: Bearer <access_token>`. Returns (trimmed):

```json
{
  "five_hour":  { "utilization": 79, "resets_at": "2026-07-07T01:49:59Z" },
  "seven_day":  { "utilization": 53, "resets_at": "2026-07-10T21:59:59Z" },
  "limits": [
    { "kind": "session",       "group": "session", "percent": 79, "severity": "warning", "resets_at": "…", "is_active": true },
    { "kind": "weekly_all",    "group": "weekly",  "percent": 53, "severity": "normal",  "resets_at": "…" },
    { "kind": "weekly_scoped", "group": "weekly",  "percent": 77, "severity": "warning", "scope": {"model": {"display_name": "Fable"}} }
  ]
}
```

- **Session usage % = `five_hour.utilization`.** **Weekly usage % = `seven_day.utilization`.**
- `limits[]` also gives normalized `percent` + `severity` (normal/warning) + `resets_at` — use `severity` to drive key color, `resets_at` for a countdown.
- Not cached on disk anywhere — must be fetched live.
- `GET /api/oauth/profile` returns account/org details (`has_claude_max`, `email`, org name) for labeling.

## Agents waiting for input — no cloud source

- Cloud Cowork API exists (`/v1/environments`, `/v1/sessions`, `/v1/agents`) behind
  beta headers, but it only tracks **remote/cloud Cowork sessions**. With the same
  token that returns live usage, `/v1/sessions` and `/v1/environments` both return
  `200` with **empty `data`** despite many active local sessions on this machine.
  - `/v1/environments` requires `anthropic-beta: environments-2025-11-01` (exactly one env beta per request).
  - `/v1/sessions` works with `anthropic-beta: oauth-2025-04-20`.
  - `/v1/agents` returns 401 with the OAuth token — it's the managed-agents/API-key product, not our route.
- No `/api/claude_code/...` endpoint syncs the local session roster. `/api/claude_code_shared_session_transcripts` is only for explicitly-shared transcripts.
- **Local roster lives at:** `%APPDATA%\Roaming\Claude\claude-code-sessions\<accountUuid>\<orgUuid>\local_*.json`
  - Per-account split is the top-level `<accountUuid>` dir (two accounts = two dirs).
  - Fields: `isArchived`, `title`, `cwd`, `lastActivityAt`, `lastFocusedAt`, `completedTurns`, `cliSessionId`, `model`, `prNumber`/`prState`.
  - No `isRunning` on disk — derive it from live PIDs in `~/.claude/sessions/<pid>.json`
    (each has `pid`, `sessionId`, `cliSessionId`, `cwd`); a matching live PID ⇒ running.
  - "Waiting for input" candidate definitions:
    - Broad: `!isArchived && !isRunning` (idle & not dismissed).
    - "Needs attention" (activity since you last looked): `!isArchived && lastActivityAt > lastFocusedAt`.
    - On this machine at spike time: 20 unarchived, 14 with activity-since-focus.

## Cross-machine plan

Each machine runs a small reporter that reads its local roster + PIDs and writes
per-account waiting counts to a shared **NAS** folder
(`<NAS>/claude-streamdeck/<machine>.json`). The plugin aggregator sums across
machine files, ignoring stale ones.
