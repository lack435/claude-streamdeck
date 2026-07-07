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

import {
	getCachedAccount,
	getCachedAccounts,
	getCachedNasPath,
	loadAccounts,
	removeAccount,
	setAlias,
	setNasPath,
	type StoredAccount,
} from "../accounts";
import { agentPoller } from "../agents";
import { beginLogin, completeLogin } from "../login";
import { colorForPct, renderCount, renderMachines, renderMessage, renderMulti, renderPercent, type MultiRow } from "../render";
import { poller } from "../usage";

/** Sentinel accountId meaning "stack every logged-in account on one tile". */
export const ALL_ACCOUNTS = "__all__";

export type MetricKind = "session" | "weekly" | "agents" | "machines";

export type MetricSettings = {
	accountId?: string;
	metric?: MetricKind;
	/** Optional custom short label shown at the top of the tile. */
	label?: string;
};

/** Messages exchanged with the property inspector. */
type PiMessage =
	| { event: "getAccounts" }
	| { event: "getConfig" }
	| { event: "setNas"; nasPath: string }
	| { event: "setAlias"; uuid: string; alias: string }
	| { event: "beginLogin" }
	| { event: "completeLogin"; code: string }
	| { event: "removeAccount"; uuid: string };

const LABELS: Record<MetricKind, string> = { session: "SESSION", weekly: "WEEK", agents: "WAITING", machines: "MACHINES" };

/** Short per-account hint shown on the tile: alias if set, else email local-part. */
function accountSub(acc: StoredAccount | undefined): string {
	if (!acc) {
		return "?";
	}
	return acc.alias?.trim() || acc.email.split("@")[0] || acc.label;
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
			case "getConfig":
				await MetricAction.toPi({ event: "config", nasPath: getCachedNasPath() ?? "" });
				break;
			case "setNas":
				await setNasPath(msg.nasPath);
				await MetricAction.toPi({ event: "config", nasPath: getCachedNasPath() ?? "" });
				void agentPoller.pollNow();
				await MetricAction.refreshAll();
				break;
			case "setAlias":
				await setAlias(msg.uuid, msg.alias);
				await MetricAction.sendAccounts();
				await MetricAction.refreshAll();
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
					void poller.pollAccount(acc.uuid);
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
			alias: a.alias ?? "",
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

		// Machines view: light each reporting machine that has a waiting agent (any account).
		if (metric === "machines") {
			if (!agentPoller.isConfigured()) {
				await act.setImage(renderMessage("MACHINES", "—", "set NAS"));
				return;
			}
			await act.setImage(renderMachines(agentPoller.getMachines()));
			return;
		}

		const label = LABELS[metric];
		if (metric === "agents" && !agentPoller.isConfigured()) {
			await act.setImage(renderMessage(label, "—", "set NAS"));
			return;
		}

		if (accountId === ALL_ACCOUNTS) {
			await MetricAction.renderCombined(act, metric, label);
			return;
		}

		if (!accountId) {
			await act.setImage(renderMessage(label, "?", "no account"));
			return;
		}

		const sub = settings.label || accountSub(getCachedAccount(accountId));

		if (metric === "agents") {
			const count = agentPoller.getCount(accountId);
			if (count === undefined) {
				await act.setImage(renderMessage(label, "…", sub));
				return;
			}
			await act.setImage(renderCount(label, count, sub));
			return;
		}
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

	/** Render one row per logged-in account for the given metric. */
	private static async renderCombined(act: KeyAction<MetricSettings>, metric: MetricKind, label: string): Promise<void> {
		const accounts = getCachedAccounts();
		if (accounts.length === 0) {
			await act.setImage(renderMessage(label, "?", "no accts"));
			return;
		}
		const rows: MultiRow[] = accounts.map((acc) => {
			const tag = accountSub(acc);
			if (metric === "agents") {
				const count = agentPoller.getCount(acc.uuid);
				return { tag, value: count === undefined ? "…" : String(count), color: (count ?? 0) > 0 ? "#58a6ff" : "#484f58" };
			}
			const snap = poller.getSnapshot(acc.uuid);
			if (!snap) {
				return { tag, value: poller.getError(acc.uuid) ? "!" : "…", color: "#484f58" };
			}
			const pct = metric === "weekly" ? snap.weeklyPct : snap.sessionPct;
			const severity = metric === "weekly" ? snap.weeklySeverity : snap.sessionSeverity;
			return { tag, value: `${pct}%`, pct, color: colorForPct(pct, severity) };
		});
		await act.setImage(renderMulti(label, rows));
	}
}
