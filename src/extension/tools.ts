/** pi tool + command surface for zvec-grep (zg). */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { keyHint } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Text } from '@earendil-works/pi-tui';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
import { buildIndexArgs, type ZvecIndexParams } from '../core/indexing.ts';
import { buildQueryArgs, type ZvecSearchQueryParams } from '../core/queries.ts';
import {
	hitHeadline,
	parseIndexOutput,
	parseSearchOutput,
	parseStatusVerdict,
	type ZgIndexSummary,
	type ZgSearchSummary,
	type ZgStatusVerdict,
} from '../core/format.ts';
import { clip, normalizeRoot } from '../core/workspace.ts';
import {
	createZgRunner,
	ZG_INDEX_TIMEOUT_MS,
	ZG_STATUS_TIMEOUT_MS,
} from '../core/zg.ts';

/**
 * Routing guidance baked into tool descriptions: zg is the semantic/layered
 * route; plain `rg` stays the workhorse for exact text (counts, -l, pipes,
 * exit codes), which managed `zg query --rg` deliberately does not replace.
 */
const SEARCH_GUIDANCE =
	'For exact strings, regex, filenames, counts, file lists, or anything piped, use bash rg instead. ' +
	'Requires a workspace index (zvec_index tool or /zg index); zg reports a clear hint when one is missing.';

const searchParams = Type.Object({
	query: Type.Optional(Type.String({ description: 'One hybrid natural-language or exact query — the usual way to call this tool' })),
	queries: Type.Optional(Type.Array(Type.String(), { description: 'Explicit hybrid query groups' })),
	fts: Type.Optional(Type.Array(Type.String(), { description: 'Ranked lexical constraints (identifiers, exact phrases); not an exhaustive occurrence lookup' })),
	vector: Type.Optional(Type.Array(Type.String(), { description: 'Semantic-only query groups' })),
	fuse: Type.Optional(Type.Boolean({ description: 'Combine every query group into one ranked list' })),
	limit: Type.Optional(Type.Number({ description: 'Max items per group (default 7, up to 50)', minimum: 1, maximum: 50 })),
	globs: Type.Optional(Type.Array(Type.String(), { description: 'Ordered path globs; prefix with ! to exclude' })),
	fileTypes: Type.Optional(Type.Array(Type.String(), { description: 'ripgrep include types (ts, py, md, ...)' })),
	excludedFileTypes: Type.Optional(Type.Array(Type.String(), { description: 'ripgrep exclude types' })),
	symbolTypes: Type.Optional(Type.Array(Type.String(), { description: 'Indexed symbol focus: module, class, interface, function, value, alias' })),
	preferSymbol: Type.Optional(Type.Boolean({ description: 'Prefer exact indexed symbols' })),
	modifiedAfter: Type.Optional(Type.String({ description: 'Only files modified after this date/time' })),
	modifiedBefore: Type.Optional(Type.String({ description: 'Only files modified before this date/time' })),
	root: Type.Optional(Type.String({ description: 'Workspace root to search; defaults to the current working directory' })),
});

const indexParams = Type.Object({
	root: Type.String({ description: 'Workspace root to index (absolute, or relative to cwd)' }),
	mode: Type.Optional(Type.Union([
		Type.Literal('index'),
		Type.Literal('rebuild'),
		Type.Literal('drop'),
	], { description: 'index (default): create or incrementally update; rebuild: recreate from scratch; drop: delete the index' })),
	embedding: Type.Optional(Type.String({ description: 'Embedding model, e.g. local/potion-code-16m-v2 (code) or local/potion-retrieval-32m (text). Defaults to the model zg has configured.' })),
	globs: Type.Optional(Type.Array(Type.String(), { description: 'Include path globs; prefix with ! to exclude' })),
	fileTypes: Type.Optional(Type.Array(Type.String(), { description: 'ripgrep include types to index' })),
	excludedFileTypes: Type.Optional(Type.Array(Type.String(), { description: 'ripgrep exclude types' })),
	hidden: Type.Optional(Type.Boolean({ description: 'Also index hidden paths (except .git and .zvec-grep)' })),
});

const statusParams = Type.Object({
	root: Type.Optional(Type.String({ description: 'Workspace root to check; defaults to the current working directory' })),
});

/** Cap a call-line display snippet so long args do not stretch the row. */
const short = (s: string, max = 60): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Call-row renderer: reuse the previous Text component (built-in convention). */
function callRow(context: { lastComponent?: unknown }, content: string): Text {
	const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0);
	text.setText(content);
	return text;
}

/** Theme surface we use (subset of pi's theme object). */
interface ThemeFg {
	fg(color: string, s: string): string;
	bold(s: string): string;
}

/** Shape of the result object as passed to renderResult by the tool row. */
interface RenderResult {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
}

function resultText(result: RenderResult): string {
	for (const c of result.content) {
		if (c.type === 'text' && typeof c.text === 'string') return c.text;
	}
	return '';
}

/** Expand hint on collapsed rows; deferred so module import never touches the pi theme. */
function expandHint(): string {
	return ' ' + keyHint('app.tools.expand', 'to expand');
}

/** Minimal result renderer: first few dim lines + expand hint (unknown format). */
function previewRow(raw: string, theme: ThemeFg, lines = 3): Text {
	const rows = raw.split('\n');
	let text = rows.slice(0, lines).map((l) => theme.fg('dim', l)).join('\n');
	if (rows.length > lines) text += theme.fg('muted', `\n… ${rows.length - lines} more lines${expandHint()}`);
	return new Text(text, 0, 0);
}

/** Styled full `zg query` output for expanded rows. */
function styledSearchOutput(raw: string, theme: ThemeFg): string {
	return raw
		.split('\n')
		.map((l) => {
			const hm = l.match(/^#(\d+) (matchedBy=\S+ )?(\S.*)$/);
			if (hm) {
				return `${theme.fg('muted', `#${hm[1]}`)} ${hm[2] ? theme.fg('dim', hm[2]) : ''}${hm[2] ? ' ' : ''}${theme.fg('accent', hm[3])}`;
			}
			if (/^Q\d+ \[/.test(l)) return theme.fg('accent', l);
			if (/^(query groups|hits:|results:|status:)/.test(l)) return theme.fg('muted', l);
			if (/^(heading|heading_level|scope|symbol):/.test(l)) return theme.fg('dim', l);
			if (l.startsWith('…(truncated')) return theme.fg('warning', l);
			return theme.fg('toolOutput', l);
		})
		.join('\n');
}

/** Render error text: first line in error color, remainder as tool output when expanded. */
function errorRow(raw: string, theme: ThemeFg, expanded: boolean): Text {
	const rows = raw.split('\n');
	const head = rows[0] ?? 'error';
	let text = theme.fg('error', head);
	if (expanded && rows.length > 1) {
		text += '\n' + rows.slice(1).map((l) => theme.fg('toolOutput', l)).join('\n');
	} else if (rows.length > 1) {
		text += theme.fg('muted', expandHint());
	}
	return new Text(text, 0, 0);
}

interface IndexRenderState {
	startedAt?: number;
	interval?: ReturnType<typeof setInterval>;
}

/** Styled `zg index` finish block for expanded rows. */
function styledIndexOutput(raw: string, theme: ThemeFg): string {
	return raw
		.split('\n')
		.map((l) => {
			if (l.startsWith('tip\t')) return theme.fg('dim', l);
			if (l.startsWith('Workspace index')) return theme.fg('accent', l);
			return theme.fg('toolOutput', l);
		})
		.join('\n');
}

/** Search tool params as the LLM sees them (root optional, cwd fallback). */
export type SearchToolInput = ZvecSearchQueryParams & { root?: string };
export type StatusToolInput = { root?: string };

/** Register zvec_search / zvec_index / zvec_status. */
export function registerZvecTools(pi: ExtensionAPI): void {
	const runZg = createZgRunner((command, args, options) => pi.exec(command, args, options));

	pi.registerTool({
		name: 'zvec_search',
		label: 'Zvec Search',
		description:
			'Hybrid semantic + keyword search over a locally indexed workspace (zvec-grep). ' +
			'Use it when the answer is grounded in local files and the wording or location is unknown: ' +
			'fuzzy concepts, relationships, call chains, cross-file synthesis, "where is X handled", design-rationale questions. ' +
			`Returns ranked hits with file, line range, symbols, and matching source. ${SEARCH_GUIDANCE}`,
		promptSnippet: 'Semantic + exact hybrid search over the indexed workspace (local zvec-grep)',
		promptGuidelines: [
			'Use zvec_search for meaning-based or location-unknown workspace questions; keep bash grep for exact strings, regex, counts, and file lists.',
		],
		parameters: searchParams,
		async execute(_toolCallId: string, params: SearchToolInput, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const args = buildQueryArgs(params);
			const { stdout, stderr, code } = await runZg(args, { cwd: normalizeRoot(params.root, ctx.cwd), signal });
			if (code !== 0) {
				throw new Error(stderr || stdout || `zvec_search failed (exit ${code})`);
			}
			const summary = parseSearchOutput(stdout);
			return {
				content: [{ type: 'text' as const, text: clip(stdout) }],
				details: summary ? { summary } : {},
			};
		},
		renderCall(args, theme, context) {
			const a = args as SearchToolInput;
			const groupCount = (a.query ? 1 : 0) + (a.queries?.length ?? 0) + (a.fts?.length ?? 0) + (a.vector?.length ?? 0);
			const query = a.query ?? a.queries?.[0] ?? a.fts?.[0] ?? a.vector?.[0] ?? '';
			let line = theme.fg('toolTitle', theme.bold('zvec_search'));
			if (query) line += ` ${theme.fg('accent', `"${short(query)}"`)}`;
			if (groupCount > 1) line += ` ${theme.fg('dim', `+${groupCount - 1} more`)}`;
			if (a.root) line += ` ${theme.fg('toolOutput', `in ${a.root}`)}`;
			const filters = [...(a.fileTypes ?? []), ...(a.excludedFileTypes ?? []).map((f) => `!${f}`), ...(a.globs ?? []), ...(a.symbolTypes ?? [])];
			if (filters.length > 0) line += ` ${theme.fg('dim', `(${filters.join(', ')})`)}`;
			if (a.limit !== undefined) line += ` ${theme.fg('dim', `limit ${a.limit}`)}`;
			return callRow(context, line);
		},
		renderResult(result: RenderResult, options: { expanded: boolean; isPartial: boolean }, theme: ThemeFg, context: { isError?: boolean }) {
			if (options.isPartial) return new Text(theme.fg('warning', 'searching…'), 0, 0);
			const raw = resultText(result);
			if (context.isError || raw.trimStart().startsWith('Error:')) {
				return errorRow(raw, theme, options.expanded);
			}
			const summary = (result.details as { summary?: ZgSearchSummary } | undefined)?.summary;
			if (options.expanded) {
				const styled = summary ? styledSearchOutput(raw, theme) : raw;
				return new Text(theme.fg('toolOutput', styled), 0, 0);
			}
			if (!summary) return previewRow(raw, theme);
			if (summary.totalHits === 0) {
				return new Text(theme.fg('muted', 'no hits'), 0, 0);
			}
			let line = theme.fg('success', `✓ ${summary.totalHits} hit${summary.totalHits === 1 ? '' : 's'} · ${summary.fileCount} file${summary.fileCount === 1 ? '' : 's'}`);
			if (summary.hasStale) line += theme.fg('warning', ' · stale');
			line += theme.fg('muted', expandHint());
			if (summary.top) line += '\n' + theme.fg('muted', `   ${hitHeadline(summary.top)}`);
			return new Text(line, 0, 0);
		},
	});

	pi.registerTool({
		name: 'zvec_index',
		label: 'Zvec Index',
		description:
			'Create, update, rebuild, or drop the local zvec-grep workspace index for a directory. ' +
			'Call it once before zvec_search when a workspace has no index (zvec_search reports the missing index). ' +
			'Do not rebuild an existing index or drop one unless the user explicitly asks. ' +
			'Prefer a local model (local/potion-code-16m-v2 for code, local/potion-retrieval-32m for text) — it auto-downloads once and stays on this machine.',
		promptSnippet: 'Build/update/drop the local workspace index used by zvec_search',
		parameters: indexParams,
		async execute(_toolCallId: string, params: ZvecIndexParams, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext) {
			const resolvedRoot = normalizeRoot(params.root, ctx.cwd);
			const args = buildIndexArgs(params, resolvedRoot);
			(onUpdate as ((u: { content: Array<{ type: string; text: string }> }) => void) | undefined)?.({
				content: [{ type: 'text', text: `${params.mode ?? 'index'}ing ${resolvedRoot}…` }],
			});
			const { stdout, stderr, code } = await runZg(args, {
				cwd: resolvedRoot,
				signal,
				timeoutMs: ZG_INDEX_TIMEOUT_MS,
			});
			if (code !== 0) {
				throw new Error(stderr || stdout || `zvec_index failed (exit ${code})`);
			}
			return {
				content: [{ type: 'text' as const, text: clip(stdout || stderr || `zvec index finished for ${resolvedRoot}`) }],
				details: parseIndexOutput(stdout) ? { indexSummary: parseIndexOutput(stdout) } : {},
			};
		},
		renderCall(args, theme, context) {
			const a = args as ZvecIndexParams;
			const mode = a.mode ?? 'index';
			let line = theme.fg('toolTitle', theme.bold('zvec_index'));
			if (mode !== 'index') line += ` ${theme.fg(mode === 'drop' ? 'error' : 'warning', mode)}`;
			line += ` ${theme.fg('toolOutput', a.root)}`;
			if (a.embedding) line += ` ${theme.fg('dim', `· ${a.embedding}`)}`;
			return callRow(context, line);
		},
		renderResult(result: RenderResult, options: { expanded: boolean; isPartial: boolean }, theme: ThemeFg, context: { isError?: boolean; state?: unknown; invalidate(): void }) {
			const state = (context.state ?? {}) as IndexRenderState;
			if (options.isPartial) {
				// Live elapsed timer while zg runs (bash-renderer pattern).
				state.startedAt ??= Date.now();
				state.interval ??= setInterval(() => context.invalidate(), 1000);
				const secs = Math.floor((Date.now() - state.startedAt) / 1000);
				return new Text(theme.fg('warning', `indexing… ${secs}s`), 0, 0);
			}
			if (state.interval) {
				clearInterval(state.interval);
				state.interval = undefined;
			}
			const raw = resultText(result);
			if (context.isError || raw.trimStart().startsWith('Error:')) {
				return errorRow(raw, theme, options.expanded);
			}
			const summary = (result.details as { indexSummary?: ZgIndexSummary } | undefined)?.indexSummary;
			if (options.expanded) {
				return new Text(theme.fg('toolOutput', summary ? styledIndexOutput(raw, theme) : raw), 0, 0);
			}
			if (summary) {
				const changed = summary.added + summary.modified + summary.deleted;
				let line = theme.fg('success', `✓ index updated · ${summary.scanned} files · ${summary.entities ?? '–'} entities · ${summary.duration ?? '–'}`);
				line += theme.fg('muted', expandHint());
				if (changed > 0) {
					const bits = [
						summary.added > 0 ? `${summary.added} added` : '',
						summary.modified > 0 ? `${summary.modified} modified` : '',
						summary.deleted > 0 ? `${summary.deleted} deleted` : '',
					].filter(Boolean);
					line += '\n' + theme.fg('dim', `   ${bits.join(' · ')}`);
				}
				return new Text(line, 0, 0);
			}
			return previewRow(raw, theme);
		},
	});

	pi.registerTool({
		name: 'zvec_status',
		label: 'Zvec Status',
		description:
			'Show zvec-grep workspace state: index presence, coverage, freshness, and the suggested next action for a workspace root. ' +
			'Use to check whether an index is ready or stale before or after heavy edits. A missing index is a normal state, not an error.',
		promptSnippet: 'Show zvec-grep index state/freshness for a workspace',
		parameters: statusParams,
		async execute(_toolCallId: string, params: StatusToolInput, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const { stdout, stderr } = await runZg(['status'], {
				cwd: normalizeRoot(params.root, ctx.cwd),
				signal,
				timeoutMs: ZG_STATUS_TIMEOUT_MS,
			});
			// A missing index must not surface as a tool error — it is the normal
			// pre-`zvec_index` state and the agent should react to the hint text.
			const text = clip(stdout || stderr || '(no output)');
			const verdict = parseStatusVerdict(stdout);
			return {
				content: [{ type: 'text' as const, text }],
				details: verdict ? { verdict } : {},
			};
		},
		renderCall(args, theme, context) {
			const root = (args as StatusToolInput).root;
			return callRow(context, `${theme.fg('toolTitle', theme.bold('zvec_status'))} ${theme.fg('toolOutput', root ?? '(cwd)')}`);
		},
		renderResult(result: RenderResult, options: { expanded: boolean; isPartial: boolean }, theme: ThemeFg, _context: { isError?: boolean }) {
			if (options.isPartial) return new Text(theme.fg('muted', 'checking…'), 0, 0);
			const raw = resultText(result);
			const verdict = (result.details as { verdict?: ZgStatusVerdict } | undefined)?.verdict ?? parseStatusVerdict(raw);
			if (!options.expanded) {
				if (!verdict) return previewRow(raw, theme, 2);
				const color = verdict.kind === 'ready' ? 'success' : verdict.kind === 'needs-update' ? 'warning' : 'muted';
				const long = raw.split('\n').length > 4;
				return new Text(theme.fg(color, verdict.line) + (long ? theme.fg('muted', expandHint()) : ''), 0, 0);
			}
			return new Text(raw.split('\n').map((l) => theme.fg('toolOutput', l)).join('\n'), 0, 0);
		},
	});
}

/** /zg subcommands: first-token dispatch, shown in arg autocomplete and help. */
const ZG_SUBCOMMANDS: Array<{ name: string; description: string }> = [
	{ name: 'index', description: 'build or update the workspace index' },
	{ name: 'rebuild', description: 'recreate the index from scratch' },
	{ name: 'drop', description: 'permanently delete the index' },
	{ name: 'status', description: 'show index state for the workspace' },
	{ name: 'help', description: 'show /zg usage' },
];

type ZgMode = 'index' | 'rebuild' | 'drop';
type ZgCommand = ZgMode | 'status' | 'help';

const ZG_COMMANDS: readonly ZgCommand[] = ['index', 'rebuild', 'drop', 'status', 'help'];

const isZgCommand = (s: string): s is ZgCommand => (ZG_COMMANDS as readonly string[]).includes(s);

/**
 * Split /zg arguments into [command, rootArg]. Bare `/zg` (or `/zg help`)
 * shows usage; otherwise the first token must be a known subcommand.
 */
function parseZgCommand(args: string): { command: ZgCommand | 'unknown'; rootArg?: string; unknown?: string } {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const first = tokens[0];
	if (!first) return { command: 'help' };
	if (isZgCommand(first)) return { command: first, rootArg: tokens[1] };
	return { command: 'unknown', unknown: args.trim() };
}

/** First token typed after `/zg` → subcommand items; none once a second token is entered. */
function zgArgumentCompletions(prefix: string): AutocompleteItem[] | null {
	const p = (prefix ?? '').trimStart();
	if (p.includes(' ')) return null;
	return ZG_SUBCOMMANDS.map((s) => ({ value: s.name, label: s.name, description: s.description })).filter((i) => i.value.startsWith(p));
}

/** Help text shown for bare `/zg`, `/zg help`, and unknown subcommands. */
const ZG_USAGE = [
	'Usage: /zg <subcommand> [path]',
	'  <subcommand>  one of: index | rebuild | drop | status | help',
	'  [path]        workspace root (default: current directory)',
	'',
	'Examples:',
	'  /zg index',
	'  /zg index ~/code/proj',
	'  /zg status .',
].join('\n');

/**
 * Shared /zg handler logic: run the requested command against the workspace
 * root the user asked for (cwd-pinned so zg resolves the right index).
 */
async function runZgCommand(
	command: ZgCommand,
	rootArg: string | undefined,
	cwd: string,
	exec: (command: string, args: string[], options: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string; code: number }>,
	notify: (message: string, type: 'info' | 'warning' | 'error') => void,
): Promise<void> {
	if (command === 'help') {
		notify(ZG_USAGE, 'info');
		return;
	}
	if (command === 'status') {
		const root = normalizeRoot(rootArg, cwd);
		const { stdout, stderr, code } = await exec('zg', ['status'], { cwd: root, timeout: ZG_STATUS_TIMEOUT_MS });
		notify(stdout || stderr || '(no output)', code !== 0 ? 'warning' : 'info');
		return;
	}
	// index / rebuild / drop (command is narrowed to ZgMode past the early returns)
	const mode: ZgMode = command;
	const root = normalizeRoot(rootArg, cwd);
	notify(`Running zg ${mode} for ${root}… (this can take a while)`, 'info');
	const argv = ['index', root];
	if (mode === 'rebuild') argv.push('--rebuild');
	if (mode === 'drop') argv.push('--drop', '--yes');
	const { stdout, stderr, code } = await exec('zg', argv, { cwd: root, timeout: ZG_INDEX_TIMEOUT_MS });
	if (code !== 0) {
		notify(`zg ${mode} failed: ${stderr || stdout || `exit ${code}`}`, 'error');
		return;
	}
	notify(mode === 'drop' ? 'zvec index dropped.' : 'zvec index updated.', 'info');
}

/** Shared /zg command handler: parse the subcommand, then run it. */
function zgHandler(exec: (command: string, args: string[], options: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string; code: number }>) {
	return async (args: string, ctx: ExtensionContext) => {
		const parsed = parseZgCommand(args);
		const notify = (message: string, type: 'info' | 'warning' | 'error') => {
			if (ctx.hasUI) ctx.ui.notify(message, type);
		};
		if (parsed.command === 'unknown') {
			notify(`Unknown /zg subcommand: ${parsed.unknown}\n\n${ZG_USAGE}`, 'warning');
			return;
		}
		await runZgCommand(parsed.command, parsed.rootArg, ctx.cwd, exec, notify);
	};
}

/**
 * Register the /zg command: one slash command with subcommand dispatch
 * (index | rebuild | drop | status | help) and argument completion.
 */
export function registerZvecCommands(pi: ExtensionAPI): void {
	const exec = (command: string, args: string[], options: { cwd?: string; timeout?: number }) => pi.exec(command, args, options);

	pi.registerCommand('zg', {
		description: 'zvec-grep: build index, check status, rebuild, or drop — /zg <index|rebuild|drop|status|help> [path]',
		getArgumentCompletions: (prefix: string) => zgArgumentCompletions(prefix),
		handler: zgHandler(exec),
	});
}
