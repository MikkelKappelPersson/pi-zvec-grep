/**
 * Fake ExtensionAPI for exercising registerZvecTools/registerZvecCommands
 * without booting a pi session. pi.exec is a real child_process.execFile
 * bound to a PATH with the fake zg bin dir prepended, so argv/cwd/exit-code
 * behavior is tested against the same code path pi uses.
 */
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ef = promisify(execFile);

/** src/extension/tools.ts resolved relative to this helper (type-stripped). */
const toolsUrl = pathToFileURL(join(__dirname, '..', '..', 'src', 'extension', 'tools.ts')).href;
const toolsModulePromise = import(toolsUrl);

export function createFakePi({ binDir, stateDir } = {}) {
	const calls = { tools: [], commands: [], exec: [], events: [] };
	const pi = {
		registerTool: (tool) => {
			calls.tools.push(tool);
		},
		registerCommand: (name, def) => {
			calls.commands.push({ name, def });
		},
		on: (event) => {
			calls.events.push(event);
		},
		exec: async (command, args, options = {}) => {
			calls.exec.push({ command, args, options });
			const env = { ...process.env };
			if (binDir) env.PATH = `${binDir}:${env.PATH}`;
			if (stateDir) env.ZFAKE_STATE_DIR = stateDir;
			try {
				const result = await ef(command, args, { ...options, env, timeout: options.timeout ?? 30_000 });
				return { stdout: result.stdout, stderr: result.stderr, code: 0, killed: false };
			} catch (error) {
				// execFile attaches possibly-empty stdout/stderr even for spawn
				// failures; keep the real message when output is blank.
				const stdout = typeof error.stdout === 'string' ? error.stdout : (error.stdout?.toString?.() ?? '');
				const stderr = typeof error.stderr === 'string' ? error.stderr : (error.stderr?.toString?.() ?? '');
				return {
					stdout,
					stderr: stderr || (error.message ? String(error.message) : ''),
					code: typeof error.code === 'number' ? error.code : 1,
					killed: Boolean(error.killed),
				};
			}
		},
	};
	return { pi, calls };
}

/** Fake ExtensionContext for tool execute() calls. */
export function makeCtx(overrides = {}) {
	return { cwd: overrides.cwd ?? process.cwd(), hasUI: false, ...overrides };
}

/** Find a registered tool and invoke it with a fake ctx (ctx.signal is forwarded as the pi-provided signal). */
export async function invokeTool(calls, name, params, ctx) {
	const tool = calls.tools.find((t) => t.name === name);
	if (!tool) throw new Error(`tool not registered: ${name}`);
	return tool.execute('call-1', params, ctx.signal, () => {}, ctx);
}

/** Register the tools/commands against a fake pi. */
export async function registerSurface(pi) {
	const { registerZvecCommands, registerZvecTools } = await toolsModulePromise;
	registerZvecTools(pi);
	registerZvecCommands(pi);
}

export { toolsModulePromise };
