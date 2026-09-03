/**
 * Parsers for `zg`'s human output, consumed by the tool result renderers.
 *
 * The parsers are intentionally line-oriented and forgiving: a formatting
 * change upstream must degrade to "unrecognized → render nothing", never
 * throw. Keep this module pi-free for the same reason core/zg.ts is.
 */

/** One search hit: `#N` header, optional metadata, one preview line. */
export interface ZgHit {
	/** 1-based rank within its query group. */
	rank: number;
	/** e.g. "fts+vector", "fts", "vector". */
	matchedBy?: string;
	/** e.g. "src/core/queries.ts:26-45" (line range may be absent). */
	file?: string;
	/** "heading" | "symbol" | "text", from the metadata fields. */
	kind?: 'heading' | 'symbol' | 'text';
	/** Heading title or symbol name when kind is heading/symbol. */
	label?: string;
	/** Status line if the hit is stale etc. */
	status?: string;
	/** First preview line, stripped of its leading line number. */
	preview?: string;
}

/** Parsed `zg query` output (single or multiple query groups). */
export interface ZgSearchSummary {
	/** Q label → "primary" | "supplemental". */
	groups: Array<{ label: string; role: string }>;
	/** Total hits across all groups. */
	totalHits: number;
	/** Distinct files hit. */
	fileCount: number;
	/** First hit of the first group — used for the collapsed headline. */
	top?: ZgHit;
	/** Any hit flagged (e.g. "possibly_stale"). */
	hasStale: boolean;
}

const GROUP_RE = /^Q(\d+) \[([a-z]+)\]:(.*)$/;
const GROUP_HITS_RE = /^hits: (\d+)/;
const HIT_RE = /^#(\d+) (?:matchedBy=(\S+) )?(\S+(?::\d+(?:-\d+)?)?)$/;
const STATUS_RE = /^status: (.+)$/;
const HEADING_RE = /^heading: (.+)$/;
const SYMBOL_RE = /^symbol: (.+)$/;
const PREVIEW_RE = /^\d+\t/;

/** Parse `zg query` output into a summary. Returns undefined on unrecognized input. */
export function parseSearchOutput(stdout: string): ZgSearchSummary | undefined {
	const groups: ZgSearchSummary['groups'] = [];
	const files = new Set<string>();
	let total = 0;
	let hasStale = false;
	let top: ZgHit | undefined;

	let inGroup = false; // inside a Q<N> block
	let groupHasHits = false; // the "hits: N" line has been seen
	let hit: ZgHit | undefined; // hit currently collecting metadata

	for (const line of stdout.split('\n')) {
		const gm = line.match(GROUP_RE);
		if (gm) {
			inGroup = true;
			groupHasHits = false;
			hit = undefined;
			groups.push({ label: `Q${gm[1]}`, role: gm[2] });
			continue;
		}
		if (!inGroup) continue;
		if (!groupHasHits && GROUP_HITS_RE.test(line)) {
			total += Number(line.match(GROUP_HITS_RE)![1]);
			groupHasHits = true;
			continue;
		}
		if (groupHasHits && !hit) {
			const hm = line.match(HIT_RE);
			if (hm) {
				hit = { rank: Number(hm[1]), matchedBy: hm[2], file: hm[3] };
				if (!top) top = hit;
				if (hit.file) files.add(hit.file.split(':')[0]);
				continue;
			}
		}
		if (!hit || hit.preview) continue;
		const sm = line.match(STATUS_RE);
		if (sm) {
			hit.status = sm[1];
			hasStale = true;
			continue;
		}
		const htm = line.match(HEADING_RE);
		if (htm) {
			hit.kind = 'heading';
			hit.label = htm[1];
			continue;
		}
		const symm = line.match(SYMBOL_RE);
		if (symm) {
			hit.kind = 'symbol';
			hit.label = symm[1];
			continue;
		}
		if (PREVIEW_RE.test(line)) {
			hit.kind = hit.kind ?? 'text';
			hit.preview = line.replace(/^\d+\t+?/, '');
			hit = undefined; // metadata always precedes the preview; hit is complete
		}
	}

	if (groups.length === 0) return undefined;
	return { groups, totalHits: total, fileCount: files.size, top, hasStale };
}

/** One-line headline for a hit: "FILE:lines — heading|symbol|preview". */
export function hitHeadline(hit: ZgHit, maxPreview = 48): string {
	const file = hit.file ?? '';
	const raw = hit.label ?? hit.preview ?? '';
	const label = raw.length > maxPreview ? `${raw.slice(0, maxPreview - 1)}…` : raw;
	if (!file) return label;
	if (!label) return file;
	return `${file} — ${label}`;
}

/** Verdict for a `zg status` block: kind drives the color (success/warning/dim). */
export interface ZgStatusVerdict {
	kind: 'ready' | 'needs-update' | 'missing';
	line: string;
}

/**
 * Parse `zg status` output into a one-line verdict.
 * Unrecognized output (upstream reformat) → undefined, caller shows the raw block.
 */
export function parseStatusVerdict(stdout: string): ZgStatusVerdict | undefined {
	const first = stdout.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
	const changes = stdout.match(/Changes\s+(\d+) added · (\d+) modified · (\d+) deleted/);
	const added = changes ? Number(changes[1]) : 0;
	const modified = changes ? Number(changes[2]) : 0;
	const deleted = changes ? Number(changes[3]) : 0;

	if (/Workspace index is ready/.test(first)) {
		const dirty = added + modified + deleted > 0 ? ` · ${added}+${modified}~${deleted}` : '';
		return { kind: 'ready', line: `index ready${dirty}` };
	}
	if (/needs an? update/.test(first)) {
		const bits = [
			added > 0 ? `${added} added` : '',
			modified > 0 ? `${modified} modified` : '',
			deleted > 0 ? `${deleted} deleted` : '',
		].filter(Boolean);
		return { kind: 'needs-update', line: `index stale${bits.length > 0 ? ` · ${bits.join(' ')}` : ''} — run zvec_index` };
	}
	if (/index is not configured/.test(first) || /No zvec-grep index/.test(first)) {
		return { kind: 'missing', line: 'no index — run zvec_index' };
	}
	return undefined;
}
