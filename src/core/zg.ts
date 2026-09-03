/**
 * Thin wrapper around the global `zg` CLI (npm i -g @zvec/zvec-grep).
 *
 * No runtime imports from the pi packages on purpose: this module must stay
 * loadable under plain `node --experimental-strip-types` for the hermetic test
 * suite. The exec signatures mirror pi's ExecOptions/ExecResult.
 */

/** Mirrors pi's ExecOptions (the subset we pass). */
export interface ZgExecOptions {
	cwd?: string;
	signal?: AbortSignal;
	timeout?: number;
}

/** Mirrors pi's ExecResult. */
export interface ZgExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export type ExecFn = (command: string, args: string[], options?: ZgExecOptions) => Promise<ZgExecResult>;

/** Query/index calls may download and run a local embedding model. */
export const ZG_QUERY_TIMEOUT_MS = 180_000;
export const ZG_INDEX_TIMEOUT_MS = 600_000;
export const ZG_STATUS_TIMEOUT_MS = 30_000;

export interface RunZgOptions {
	cwd: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/**
 * Run `zg <args...>` in the given working directory. zg resolves the
 * workspace root from its cwd, which is why every invocation pins cwd to the
 * normalized workspace root (never the process cwd).
 */
export function createZgRunner(exec: ExecFn) {
	return async function runZg(
		args: string[],
		{ cwd, signal, timeoutMs = ZG_QUERY_TIMEOUT_MS }: RunZgOptions,
	): Promise<{ stdout: string; stderr: string; code: number }> {
		const result = await exec('zg', args, { cwd, signal, timeout: timeoutMs });
		return { stdout: result.stdout.trimEnd(), stderr: result.stderr.trimEnd(), code: result.code };
	};
}
