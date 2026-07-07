import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { loadAccounts } from "./accounts";
import { MetricAction } from "./actions/metric";
import { agentPoller } from "./agents";
import { poller } from "./usage";

streamDeck.logger.setLevel(LogLevel.INFO);

streamDeck.actions.registerAction(new MetricAction());

// Re-render all visible keys whenever fresh usage or agent counts arrive.
poller.onUpdate(() => void MetricAction.refreshAll());
agentPoller.onUpdate(() => void MetricAction.refreshAll());

await streamDeck.connect();

// Warm the account/config cache from global settings, then begin polling.
await loadAccounts(true);
poller.start();
agentPoller.start();
