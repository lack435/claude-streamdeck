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
export function colorForPct(pct: number, severity?: string): string {
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

/** Shortest uppercase prefix of each name that is unique among all names. */
function uniquePrefixes(names: string[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const name of names) {
		let len = 1;
		while (len < name.length) {
			const pfx = name.slice(0, len).toUpperCase();
			if (names.filter((o) => o.slice(0, len).toUpperCase() === pfx).length === 1) {
				break;
			}
			len++;
		}
		out.set(name, name.slice(0, len).toUpperCase());
	}
	return out;
}

/**
 * A tile that lights each reporting machine, bright when it has ≥1 waiting agent and
 * dim when clear, laid out over up to two rows. Each machine's label is its user-set
 * alias if any, else the shortest prefix of its name that's unique among the machines
 * without an alias (a single letter unless two names collide).
 */
export function renderMachines(machines: { name: string; waiting: number }[], aliases: Record<string, string> = {}): string {
	if (machines.length === 0) {
		return renderMessage("MACHINES", "—", "offline");
	}
	const prefixes = uniquePrefixes(machines.map((m) => m.name).filter((n) => !aliases[n]));
	const parts = machines.map((m) => ({
		label: aliases[m.name] || prefixes.get(m.name) || (m.name[0] ?? "?").toUpperCase(),
		lit: m.waiting > 0,
	}));

	// Up to two rows; split the list in half when there are more than two machines.
	const rows = parts.length <= 2 ? [parts] : [parts.slice(0, Math.ceil(parts.length / 2)), parts.slice(Math.ceil(parts.length / 2))];
	const widest = Math.max(...rows.map((r) => r.reduce((s, p) => s + p.label.length, 0) + (r.length - 1)));
	const size = Math.max(16, Math.min(50, Math.floor(150 / Math.max(1, widest))));
	const ys = rows.length === 1 ? [82] : [60, 106];
	const spacer = `<tspan fill="#3a4048"> </tspan>`;

	const lines = rows
		.map((r, i) => {
			const body = r.map((p) => `<tspan fill="${p.lit ? "#58a6ff" : "#3a4048"}">${escapeXml(p.label)}</tspan>`).join(spacer);
			return `<text x="${CX}" y="${ys[i]}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${size}" font-weight="700">${body}</text>`;
		})
		.join("");
	return frame(
		`<text x="${CX}" y="16" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="600" letter-spacing="1" fill="#6e7681">MACHINES</text>${lines}`,
	);
}

/** One account's line in a combined tile. */
export type MultiRow = {
	/** Short account tag shown on the left. */
	tag: string;
	/** Value shown on the right, e.g. "25%" or "4". */
	value: string;
	/** 0–100 for a progress bar; omit for counts. */
	pct?: number;
	color: string;
};

/** A tile stacking several accounts' values for one metric. */
export function renderMulti(label: string, rows: MultiRow[]): string {
	const top = 24;
	const bottom = 144;
	const rowH = (bottom - top) / Math.max(1, rows.length);
	const body = rows
		.map((row, i) => {
			const rt = top + rowH * i;
			const hasBar = row.pct !== undefined;
			const cy = rt + rowH / 2 - (hasBar ? 6 : 0);
			const valueSize = row.value.length >= 4 ? 30 : row.value.length === 3 ? 36 : 42;
			const tag = escapeXml(row.tag.slice(0, 8));
			const line =
				`<text x="10" y="${cy}" dominant-baseline="central" font-family="sans-serif" font-size="17" fill="#aeb6c0">${tag}</text>` +
				`<text x="${CX}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${valueSize}" font-weight="700" fill="${row.color}">${escapeXml(row.value)}</text>`;
			const bar = !hasBar
				? ""
				: `<rect x="10" y="${rt + rowH - 13}" width="124" height="6" rx="3" fill="#21262d"/>` +
					`<rect x="10" y="${rt + rowH - 13}" width="${((Math.max(0, Math.min(100, row.pct!)) / 100) * 124).toFixed(1)}" height="6" rx="3" fill="${row.color}"/>`;
			return line + bar;
		})
		.join("");
	return frame(
		`<text x="${CX}" y="13" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="600" letter-spacing="1" fill="#6e7681">${escapeXml(label)}</text>${body}`,
	);
}
