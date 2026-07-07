import {
	action,
	type DidReceiveSettingsEvent,
	type JsonValue,
	type KeyAction,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { getCachedAccount, getCachedAccounts, loadAccounts, removeAccount, type StoredAccount } from "../accounts";
import { beginLogin, completeLogin } from "../login";
import { renderMessage, renderPercent } from "../render";
import { poller } from "../usage";

export type MetricKind = "session" | "weekly" | "agents";

export type MetricSettings = {
	accountId?: string;
	metric?: MetricKind;
	/** Optional custom short label shown at the top of the tile. */
	label?: string;
};

/** Messages exchanged with the property inspector. */
type PiMessage =
	| { event: "getAccounts" }
	| { event: "beginLogin" }
	| { event: "completeLogin"; code: string }
	| { event: "removeAccount"; uuid: string };

const LABELS: Record<MetricKind, string> = { session: "SESSION", weekly: "WEEK", agents: "WAITING" };

/** Short per-account hint (email local-part) shown atop the tile. */
function accountSub(acc: StoredAccount | undefined): string {
	if (!acc) {
		return "?";
	}
	return acc.email.split("@")[0] || acc.label;
}

@action({ UUID: "com.lack435.claude-code.metric" })
export class MetricAction extends SingletonAction<MetricSettings> {
	/** Currently-visible key instances, so the poller can refresh them all. */
	private static readonly visible = new Map<string, KeyAction<MetricSettings>>();

	override onWillAppear(ev: WillAppearEvent<MetricSettings>): Promise<void> | void {
		if (!ev.action.isKey()) {
			return;
		}
		MetricAction.visible.set(ev.action.id, ev.action);
		return MetricAction.render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<MetricSettings>): void {
		MetricAction.visible.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<MetricSettings>): Promise<void> | void {
		if (!ev.action.isKey()) {
			return;
		}
		return MetricAction.render(ev.action, ev.payload.settings);
	}

	override async onPropertyInspectorDidAppear(): Promise<void> {
		await loadAccounts();
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, MetricSettings>): Promise<void> {
		const msg = ev.payload as PiMessage;
		switch (msg.event) {
			case "getAccounts":
				await MetricAction.sendAccounts();
				break;
			case "beginLogin": {
				const url = beginLogin();
				await MetricAction.toPi({ event: "loginStarted", url });
				break;
			}
			case "completeLogin":
				try {
					const acc = await completeLogin(msg.code);
					await MetricAction.toPi({ event: "loginResult", ok: true, label: acc.label, uuid: acc.uuid });
					await MetricAction.sendAccounts();
					void poller.pollNow();
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					streamDeck.logger.warn(`Login failed: ${message}`);
					await MetricAction.toPi({ event: "loginResult", ok: false, message });
				}
				break;
			case "removeAccount":
				await removeAccount(msg.uuid);
				await MetricAction.sendAccounts();
				await MetricAction.refreshAll();
				break;
		}
	}

	/** Send a message to the currently-visible property inspector. */
	private static async toPi(payload: JsonValue): Promise<void> {
		await streamDeck.ui.current?.sendToPropertyInspector(payload);
	}

	/** Send the account list to the PI (populates the account dropdown). */
	private static async sendAccounts(): Promise<void> {
		const items = getCachedAccounts().map((a) => ({
			label: a.plan ? `${a.label} (${a.plan})` : a.label,
			value: a.uuid,
		}));
		await MetricAction.toPi({ event: "getAccounts", items });
	}

	/** Re-render every visible key from the latest poller snapshots. */
	static async refreshAll(): Promise<void> {
		for (const act of MetricAction.visible.values()) {
			const settings = await act.getSettings();
			await MetricAction.render(act, settings);
		}
	}

	private static async render(act: KeyAction<MetricSettings>, settings: MetricSettings): Promise<void> {
		const { metric, accountId } = settings;

		if (!metric) {
			await act.setImage(renderMessage("CLAUDE", "•", "set up"));
			return;
		}

		// Agents-waiting arrives in milestone 2 (NAS aggregation).
		if (metric === "agents") {
			await act.setImage(renderMessage(LABELS.agents, "—", "soon"));
			return;
		}

		const label = LABELS[metric];
		if (!accountId) {
			await act.setImage(renderMessage(label, "?", "no account"));
			return;
		}

		const sub = settings.label || accountSub(getCachedAccount(accountId));
		const snap = poller.getSnapshot(accountId);
		if (!snap) {
			const hasError = poller.getError(accountId);
			await act.setImage(renderMessage(label, hasError ? "!" : "…", hasError ? "auth?" : sub));
			return;
		}

		const pct = metric === "weekly" ? snap.weeklyPct : snap.sessionPct;
		const severity = metric === "weekly" ? snap.weeklySeverity : snap.sessionSeverity;
		await act.setImage(renderPercent(label, pct, sub, severity));
	}
}
