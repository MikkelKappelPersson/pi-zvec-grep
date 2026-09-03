/** pi tool + command surface for zvec-grep (zg). */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Text } from '@earendil-works/pi-tui';
import { buildIndexArgs, type ZvecIndexParams } from '../core/indexing.ts';
import { buildQueryArgs, type ZvecSearchQueryParams } from '../core/queries.ts';
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
	'Requires a workspace index (zvec_index or /zg-index); zg reports a clear hint when one is missing.';

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
			'Use zvec_search for meaning-based or location-unknown workspace questions; keep bash rg for exact strings, regex, counts, and file lists.',
		],
		parameters: searchParams,
		async execute(_toolCallId: string, params: SearchToolInput, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const args = buildQueryArgs(params);
			const { stdout, stderr, code } = await runZg(args, { cwd: normalizeRoot(params.root, ctx.cwd), signal });
			if (code !== 0) {
				throw new Error(stderr || stdout || `zvec_search failed (exit ${code})`);
			}
			return {
				content: [{ type: 'text' as const, text: clip(stdout) }],
				details: {},
			};
		},
		renderCall(args, theme) {
			const a = args as SearchToolInput;
			const query = a.query ?? a.queries?.[0] ?? a.fts?.[0] ?? a.vector?.[0] ?? '';
			return new Text(`  ${a.root ? `${theme.fg('dim', a.root)}  ` : ''}${theme.fg('text', query)}`, 0);
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
				details: {},
			};
		},
		renderCall(args, theme) {
			const a = args as ZvecIndexParams;
			return new Text(
				`  ${theme.fg('text', `${a.mode ?? 'index'} ${a.root}`)}${a.embedding ? theme.fg('dim', ` · ${a.embedding}`) : ''}`,
				0,
			);
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
			return {
				content: [{ type: 'text' as const, text: clip(stdout || stderr || '(no output)') }],
				details: {},
			};
		},
		renderCall(args, theme) {
			const root = (args as StatusToolInput).root;
			return new Text(`  ${theme.fg('text', root ?? '(cwd)')}`, 0);
		},
	});
}

/** Register /zg-index and /zg-status. */
export function registerZvecCommands(pi: ExtensionAPI): void {
	pi.registerCommand('zg-index', {
		description: 'Build or update the zvec-grep index for the current (or named) workspace',
		handler: async (args: string, ctx) => {
			const root = normalizeRoot(args, ctx.cwd);
			if (ctx.hasUI) ctx.ui.notify(`Building zvec index for ${root}… (this can take a while)`, 'info');
			const { stdout, stderr, code } = await pi.exec('zg', ['index', root], {
				cwd: root,
				timeout: ZG_INDEX_TIMEOUT_MS,
			});
			if (code !== 0) {
				if (ctx.hasUI) ctx.ui.notify(`zg index failed: ${stderr || stdout || `exit ${code}`}`, 'error');
				return;
			}
			if (ctx.hasUI) ctx.ui.notify('zvec index updated.', 'info');
		},
	});

	pi.registerCommand('zg-status', {
		description: 'Show zvec-grep index state for the current (or named) workspace',
		handler: async (args: string, ctx) => {
			const root = normalizeRoot(args, ctx.cwd);
			const { stdout, stderr, code } = await pi.exec('zg', ['status'], {
				cwd: root,
				timeout: ZG_STATUS_TIMEOUT_MS,
			});
			if (ctx.hasUI) ctx.ui.notify(stdout || stderr || '(no output)', code !== 0 ? 'warning' : 'info');
		},
	});
}
