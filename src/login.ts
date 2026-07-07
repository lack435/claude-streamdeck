import { spawn } from "node:child_process";

import streamDeck from "@elgato/streamdeck";

import { accountFromToken, type StoredAccount } from "./accounts";
import { buildAuthorizeUrl, createPkce, exchangeCode, type Pkce } from "./oauth";

// A single login can be in progress at a time (the PI drives it sequentially).
let pending: Pkce | undefined;

/** Open a URL in the user's default browser without a shell (avoids `&` parsing issues). */
export function openBrowser(url: string): void {
	try {
		let child;
		if (process.platform === "win32") {
			child = spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" });
		} else if (process.platform === "darwin") {
			child = spawn("open", [url], { detached: true, stdio: "ignore" });
		} else {
			child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
		}
		child.unref();
	} catch (err) {
		streamDeck.logger.warn("Could not open browser automatically", err);
	}
}

/** Start an OAuth login: generate PKCE, open the browser, and return the URL (as a fallback link). */
export function beginLogin(): string {
	pending = createPkce();
	const url = buildAuthorizeUrl(pending);
	openBrowser(url);
	return url;
}

/** Complete an OAuth login using the pasted `code#state`, persisting the account. */
export async function completeLogin(rawCode: string): Promise<StoredAccount> {
	if (!pending) {
		throw new Error("No login in progress — click \"Add account\" first.");
	}
	const tokens = await exchangeCode(rawCode, pending);
	pending = undefined;
	return accountFromToken(tokens);
}
