# Claude Code Stream Deck plugin

An Elgato Stream Deck plugin that shows Claude Code state per account, across multiple machines:

- **Session usage %** — your rolling 5-hour limit (from `/api/oauth/usage`)
- **Weekly usage %** — your weekly limit
- **Agents waiting for input** — count of unarchived agents awaiting you *(Milestone 2 — NAS aggregation, in progress)*

Usage is fetched live from Anthropic's OAuth usage API, so it reflects all your machines automatically. Each account logs in once via the plugin (OAuth PKCE); tokens are stored and refreshed by the plugin.

## Actions

One action, **Claude Metric** — drop it on any key and configure `{account, metric}` in the Property Inspector. Add as many keys as you like.

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
