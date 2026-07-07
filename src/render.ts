/** Builds Stream Deck key images as inline SVG data URIs. */

const SIZE = 144;
const CX = 72;
const CY = 66;
const R = 46;
const STROKE = 11;
const CIRC = 2 * Math.PI * R;

function escapeXml(s: string): string {
	return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/** Green → amber → red by percentage. */
function colorForPct(pct: number, severity?: string): string {
	if (severity === "warning" || pct >= 80) {
		return "#f85149";
	}
	if (pct >= 50) {
		return "#d29922";
	}
	return "#3fb950";
}

function toDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function frame(inner: string): string {
	return toDataUri(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
			`<rect width="${SIZE}" height="${SIZE}" fill="#0d1117"/>${inner}</svg>`,
	);
}

type RingOptions = {
	/** Big centered value, e.g. "79%" or "3". */
	value: string;
	/** Bottom label, e.g. "SESSION". */
	label: string;
	/** Optional small top line, e.g. an account hint. */
	sub?: string;
	/** 0–100 ring fill; omit for no ring arc. */
	pct?: number;
	color: string;
	/** Dim the whole tile (e.g. zero / inactive). */
	dim?: boolean;
};

function ring(opts: RingOptions): string {
	const { value, label, sub, pct, color, dim } = opts;
	const opacity = dim ? 0.5 : 1;
	const dash = pct === undefined ? 0 : (Math.max(0, Math.min(100, pct)) / 100) * CIRC;
	const arc =
		pct === undefined
			? ""
			: `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="${STROKE}" ` +
				`stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${CIRC.toFixed(1)}" ` +
				`transform="rotate(-90 ${CX} ${CY})"/>`;
	const valueSize = value.length >= 4 ? 30 : 38;
	return (
		`<g opacity="${opacity}">` +
		(sub ? `<text x="${CX}" y="20" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#8b949e">${escapeXml(sub)}</text>` : "") +
		`<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#21262d" stroke-width="${STROKE}"/>` +
		arc +
		`<text x="${CX}" y="${CY}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${valueSize}" font-weight="700" fill="#ffffff">${escapeXml(value)}</text>` +
		`<text x="${CX}" y="128" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="600" letter-spacing="1" fill="#c9d1d9">${escapeXml(label)}</text>` +
		`</g>`
	);
}

/** A usage percentage tile with a colored progress ring. */
export function renderPercent(label: string, pct: number, sub?: string, severity?: string): string {
	return frame(ring({ value: `${pct}%`, label, sub, pct, color: colorForPct(pct, severity) }));
}

/** A waiting-agents count tile. */
export function renderCount(label: string, count: number, sub?: string): string {
	return frame(ring({ value: `${count}`, label, sub, color: count > 0 ? "#58a6ff" : "#30363d", dim: count === 0 }));
}

/** Placeholder / status tiles. */
export function renderMessage(label: string, value: string, sub?: string): string {
	return frame(ring({ value, label, sub, color: "#30363d", dim: true }));
}
