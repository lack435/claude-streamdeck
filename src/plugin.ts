import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { loadAccounts } from "./accounts";
import { MetricAction } from "./actions/metric";
import { poller } from "./usage";

streamDeck.logger.setLevel(LogLevel.INFO);

streamDeck.actions.registerAction(new MetricAction());

// Re-render all visible keys whenever fresh usage arrives.
poller.onUpdate(() => void MetricAction.refreshAll());

await streamDeck.connect();

// Warm the account cache from global settings, then begin polling usage.
await loadAccounts(true);
poller.start();
