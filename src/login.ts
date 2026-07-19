import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";

import streamDeck from "@elgato/streamdeck";

import { accountFromCodexTokens, accountFromToken, type StoredAccount } from "./accounts";
import { buildCodexAuthorizeUrl, exchangeCodexCode } from "./codex";
import { CODEX_LOGIN_TIMEOUT_MS, CODEX_OAUTH } from "./config";
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

// The in-flight Codex callback server, so a new login (or cancel) can tear it down.
let codexServer: Server | undefined;

/** Abort any pending Codex login and free port 1455. */
export function cancelCodexLogin(): void {
	codexServer?.close();
	codexServer = undefined;
}

/**
 * Start a Codex (ChatGPT) OAuth login. The client's redirect URI is fixed at
 * localhost:1455, so we host a one-shot HTTP server there to catch the callback
 * and exchange the code — no paste step. Resolves with the stored account once
 * the user approves in the browser.
 */
export function beginCodexLogin(): { url: string; result: Promise<StoredAccount> } {
	cancelCodexLogin();
	const pkce = createPkce();
	const url = buildCodexAuthorizeUrl(pkce);

	const result = new Promise<StoredAccount>((resolve, reject) => {
		const server = createServer((req, res) => {
			void (async () => {
				const reqUrl = new URL(req.url ?? "/", `http://localhost:${CODEX_OAUTH.redirectPort}`);
				if (reqUrl.pathname !== "/auth/callback") {
					res.writeHead(404).end();
					return;
				}
				const code = reqUrl.searchParams.get("code");
				const state = reqUrl.searchParams.get("state");
				try {
					if (!code || state !== pkce.state) {
						throw new Error(reqUrl.searchParams.get("error_description") ?? "Callback had no code or a mismatched state.");
					}
					const tokens = await exchangeCodexCode(code, pkce);
					const acc = await accountFromCodexTokens(tokens);
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end("<html><body style=\"font-family:sans-serif\"><h3>Codex account added to Stream Deck.</h3>You can close this tab.</body></html>");
					finish(() => resolve(acc));
				} catch (err) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end("<html><body style=\"font-family:sans-serif\"><h3>Login failed.</h3>Check the Stream Deck property inspector.</body></html>");
					finish(() => reject(err instanceof Error ? err : new Error(String(err))));
				}
			})();
		});

		const timeout = setTimeout(() => finish(() => reject(new Error("Codex login timed out — try again."))), CODEX_LOGIN_TIMEOUT_MS);

		function finish(settle: () => void): void {
			clearTimeout(timeout);
			if (codexServer === server) {
				codexServer = undefined;
			}
			server.close();
			settle();
		}

		server.on("error", (err: NodeJS.ErrnoException) => {
			const message =
				err.code === "EADDRINUSE"
					? `Port ${CODEX_OAUTH.redirectPort} is in use (is a \`codex login\` running?) — close it and try again.`
					: `Could not listen on port ${CODEX_OAUTH.redirectPort}: ${err.message}`;
			finish(() => reject(new Error(message)));
		});
		server.listen(CODEX_OAUTH.redirectPort, "127.0.0.1", () => {
			codexServer = server;
			openBrowser(url);
		});
	});

	// Surface failures via the caller's handler, not as an unhandled rejection.
	result.catch(() => undefined);
	return { url, result };
}
