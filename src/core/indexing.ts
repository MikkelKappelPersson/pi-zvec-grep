/** Build `zg index ...` argv from zvec_index parameters. Throws on invalid combinations. */

export type ZvecIndexMode = 'index' | 'rebuild' | 'drop';

export interface ZvecIndexParams {
	root: string;
	mode?: ZvecIndexMode;
	embedding?: string;
	globs?: string[];
	fileTypes?: string[];
	excludedFileTypes?: string[];
	hidden?: boolean;
}

export function buildIndexArgs(params: ZvecIndexParams, resolvedRoot: string): string[] {
	const mode = params.mode ?? 'index';
	const args: string[] = ['index', resolvedRoot];
	if (mode === 'rebuild') args.push('--rebuild');
	if (mode === 'drop') {
		// The tool surface is non-interactive; drop must carry --yes.
		args.push('--drop', '--yes');
	}
	if (params.embedding) args.push('--embedding', params.embedding);
	for (const g of params.globs ?? []) args.push('-g', g);
	for (const t of params.fileTypes ?? []) args.push('-t', t);
	for (const t of params.excludedFileTypes ?? []) args.push('-T', t);
	if (params.hidden) args.push('--hidden');
	return args;
}
