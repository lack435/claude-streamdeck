# Claude Code Stream Deck plugin

An Elgato Stream Deck plugin that shows Claude Code state per account, across multiple machines:

- **Session usage %** — your rolling 5-hour limit (from `/api/oauth/usage`)
- **Weekly usage %** — your weekly limit
- **Agents waiting for input** — count of unarchived agents awaiting you *(Milestone 2 — NAS aggregation, in progress)*

Usage is fetched live from Anthropic's OAuth usage API, so it reflects all your machines automatically. Each account logs in once via the plugin (OAuth PKCE); tokens are stored and refreshed by the plugin.

## Actions

One action, **Claude Metric** — drop it on any key and configure `{account, metric}` in the Property Inspector. Add as many keys as you like.

## Setup

1. Add a **Claude Metric** key, open its Property Inspector, click **Add / re-login account**, and complete the browser login. Repeat for each account (personal, work).
2. Pick a **metric** and **account** per key.
3. For **Agents waiting** across machines, set the **NAS folder** field to a shared path every machine can reach (e.g. a mapped drive `Y:\Claude\Streamdeck`). The plugin's own machine reports itself automatically.

### Reporting agents from other machines

The Stream Deck machine reports itself. Every *other* machine running Claude Code needs the reporter so its waiting agents are counted. The easiest way is the turnkey folder on the shared drive (bundles its own `node.exe`, no install needed):

1. Copy the contents of `reporter/` into `<nas>/reporter/` on the shared drive, plus a standalone `node.exe` (Windows x64) next to `report.mjs`.
2. On each other machine, double-click **`install-startup.cmd`** from that folder — it starts the reporter now (hidden) and re-runs it at every login.

`report.mjs` defaults its output to the parent folder, so dropped in `<nas>/reporter/` it writes to `<nas>/reports/<hostname>.json` every 30s with no arguments. The plugin sums all machines seen in the last 2 minutes.

For scripted/manual use: `node reporter/report.mjs --out "Y:\Claude\Streamdeck"`. Run as a **login/startup item**, not a session-0 scheduled task — mapped drives like `Y:` only exist in the interactive session (a UNC path `\\NAS\...` works from either).

### "Waiting" definition & tuning

A session counts as *waiting for your input* when it's **unarchived, not running, has ≥1 completed turn** (excludes headless/scheduled runs), and was **active within N minutes** (default 60) — across all accounts. `N` lives in `<nas>/waiting-config.json` (`{"inactiveMinutes": 60}`); the plugin and every reporter re-read it within ~30s, so you can retune the window by editing that one file — no rebuild, no re-running anything.

> Usage %: the plugin polls the usage API every ~3 min per account with exponential backoff on rate limits — keep an eye out if you run multiple plugin instances against the same account.

## Develop

Requires Node and the [Elgato CLI](https://docs.elgato.com/streamdeck/cli/intro) (`npm i -g @elgato/cli`).

```bash
npm install
npm run build                 # bundle to com.lack435.claude-code.sdPlugin/bin/plugin.js
streamdeck link com.lack435.claude-code.sdPlugin
streamdeck restart com.lack435.claude-code
# or: npm run watch            # rebuild + restart on change
```

The Stream Deck app must be v7.1+ (bundles Node 20). See [docs/spike-findings.md](docs/spike-findings.md) for how the data sources were reverse-engineered.

## Layout

- `src/` — TypeScript source (bundled by Rollup)
  - `oauth.ts` / `accounts.ts` — PKCE login + rotation-safe token store
  - `usage.ts` — usage API client + poller
  - `render.ts` — SVG key images
  - `actions/metric.ts` — the Claude Metric action
- `com.lack435.claude-code.sdPlugin/` — plugin bundle (manifest, UI, images; `bin/` is built)
