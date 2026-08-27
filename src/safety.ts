import streamDeck from "@elgato/streamdeck";

/**
 * Transient network errors that must never take down the plugin. The process
 * holds keep-alive sockets open for constant usage/token polling plus the
 * WebSocket to Stream Deck; any of these can be reset by the peer at any time
 * (idle keep-alive drop, sleep/wake, VPN reconnect, server hiccup). Node
 * surfaces such a reset with no `error` listener as an *uncaught* exception,
 * which otherwise kills the whole plugin — see the `read ECONNRESET` crash at
 * `TCP.onStreamRead` with no user frames.
 */
const BENIGN_NET_CODES = new Set([
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"EPIPE",
	"ENETUNREACH",
	"EHOSTUNREACH",
	"EAI_AGAIN",
	"UND_ERR_SOCKET",
	"UND_ERR_CONNECT_TIMEOUT",
]);

function codeOf(err: unknown): string | undefined {
	if (err && typeof err === "object") {
		const code = (err as { code?: unknown }).code;
		if (typeof code === "string") {
			return code;
		}
		// undici wraps the socket error under `.cause`.
		const cause = (err as { cause?: unknown }).cause;
		if (cause && typeof cause === "object") {
			const causeCode = (cause as { code?: unknown }).code;
			if (typeof causeCode === "string") {
				return causeCode;
			}
		}
	}
	return undefined;
}

function isBenignNetworkError(err: unknown): boolean {
	const code = codeOf(err);
	return code !== undefined && BENIGN_NET_CODES.has(code);
}

/**
 * Install process-wide guards so a stray socket reset (or any unhandled
 * rejection) during polling can't crash the plugin. Uses `process.on` (not
 * `once`) so it survives repeated blips, and does NOT call `process.exit` for
 * benign network errors — the poller loops keep running and simply retry on the
 * next tick. Genuinely unexpected errors are logged loudly but still swallowed,
 * because a wedged-but-alive plugin beats a dead one for a monitoring tile.
 */
export function installGlobalErrorGuards(): void {
	process.on("uncaughtException", (err) => {
		if (isBenignNetworkError(err)) {
			streamDeck.logger.warn(`Ignored transient network error (${codeOf(err)})`);
			return;
		}
		streamDeck.logger.error("Uncaught exception (kept process alive)", err);
	});

	process.on("unhandledRejection", (reason) => {
		if (isBenignNetworkError(reason)) {
			streamDeck.logger.warn(`Ignored transient network rejection (${codeOf(reason)})`);
			return;
		}
		streamDeck.logger.error("Unhandled promise rejection (kept process alive)", reason);
	});
}
