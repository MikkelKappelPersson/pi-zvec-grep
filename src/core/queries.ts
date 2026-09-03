/** Build `zg query ...` argv from zvec_search parameters. Throws on invalid combinations. */

/** Default items per query group, matching `zg query`. */
export const DEFAULT_LIMIT = 7;

export interface ZvecSearchQueryParams {
	query?: string;
	queries?: string[];
	fts?: string[];
	vector?: string[];
	fuse?: boolean;
	limit?: number;
	globs?: string[];
	fileTypes?: string[];
	excludedFileTypes?: string[];
	symbolTypes?: string[];
	preferSymbol?: boolean;
	modifiedAfter?: string;
	modifiedBefore?: string;
}

/**
 * Positional query first, then explicit route groups. zg rejects an empty
 * query set itself, but we fail fast with a clearer message for the model.
 */
export function buildQueryArgs(params: ZvecSearchQueryParams): string[] {
	const args: string[] = ['query'];
	if (!params.query && !params.queries?.length && !params.fts?.length && !params.vector?.length) {
		throw new Error('zvec_search needs at least one of: query, queries, fts, or vector');
	}
	if (params.query) args.push(params.query);
	for (const q of params.queries ?? []) args.push('--hybrid', q);
	for (const q of params.fts ?? []) args.push('--fts', q);
	for (const q of params.vector ?? []) args.push('--vector', q);
	if (params.fuse) args.push('--fuse');
	args.push('--limit', String(params.limit ?? DEFAULT_LIMIT));
	for (const g of params.globs ?? []) args.push('-g', g);
	for (const t of params.fileTypes ?? []) args.push('-t', t);
	for (const t of params.excludedFileTypes ?? []) args.push('-T', t);
	for (const s of params.symbolTypes ?? []) args.push('--symbol-type', s);
	if (params.preferSymbol) args.push('--prefer-symbol');
	if (params.modifiedAfter) args.push('--modified-after', params.modifiedAfter);
	if (params.modifiedBefore) args.push('--modified-before', params.modifiedBefore);
	return args;
}
