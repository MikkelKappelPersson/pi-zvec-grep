/** Workspace path and output helpers for pi-zvec-grep. */

import { resolve } from 'node:path';

/**
 * Normalize a user-supplied workspace root: empty → cwd, leading `@` stripped
 * (some models paste tool-path conventions into arguments), relative paths
 * resolved against cwd.
 */
export function normalizeRoot(root: string | undefined, cwd: string): string {
	if (!root || !root.trim()) return cwd;
	const cleaned = root.trim().replace(/^@/, '');
	return resolve(cwd, cleaned);
}

/** Cap tool output sent to the model; large searches must not blow the context. */
export function clip(text: string, limit = 60_000): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n…(truncated ${text.length - limit} chars)`;
}
