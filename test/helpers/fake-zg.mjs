/**
 * Deterministic fake `zg` executable for pi-zvec-grep tests.
 *
 * Written into a temp bin dir and prepended to PATH via the fake pi.exec.
 * Behavior is controlled by env on the harness side:
 *   ZFAKE_STATE_DIR  — receives <cmd>.json with { cwd, args } per invocation
 *   ZFAKE_MODE       — status behavior drives the guard; default and
 *                      "missing-index" fail like a no-index workspace,
 *                      "ready" succeeds. "stale-slow": status fails and the
 *                      index subcommand sleeps (ZFAKE_INDEX_SLEEP seconds)
 *                      before completing — models a multi-minute real build.
 *                      "fail-index": status fails and the index subcommand
 *                      exits 1 after recording.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const stateDir = process.env.ZFAKE_STATE_DIR;
const [cmd, ...rest] = process.argv.slice(2);
const record = (name) => {
  if (!stateDir) return;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, name + '.json'), JSON.stringify({ cwd: process.cwd(), args: rest }));
};
if (cmd === 'query') {
  if (process.env.ZFAKE_MODE === 'missing-index') {
    process.stderr.write('Error: No zvec-grep index found for this workspace\\nCode: ZVEC_GREP.ENGINE.SERVICE.WORKSPACE_INDEX_NOT_FOUND\\n');
    process.exit(1);
  }
  record('query');
  console.log('FAKE-QUERY args: ' + rest.join(' '));
} else if (cmd === 'index') {
  if (process.env.ZFAKE_MODE === 'stale-slow') {
    const ms = Number(process.env.ZFAKE_INDEX_SLEEP || 0) * 1000;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
  record('index');
  if (process.env.ZFAKE_MODE === 'fail-index') {
    process.stderr.write('FAKE-INDEX exploded\\n');
    process.exit(1);
  }
  console.log('FAKE-INDEX args: ' + rest.join(' ') + ' cwd=' + process.cwd());
} else if (cmd === 'status') {
  record('status');
  if (process.env.ZFAKE_MODE !== 'ready') {
    console.log('No index for ' + process.cwd());
    process.exit(1);
  }
  console.log('FAKE-STATUS ready cwd=' + process.cwd());
} else {
  process.stderr.write('FAKE-ZG unknown command: ' + cmd + '\\n');
  process.exit(2);
}
`;

/** Create a temp dir with an executable fake `zg` on disk; returns { binDir, clean() }. */
export function createFakeZg(root) {
	const binDir = path.join(root, 'bin');
	const stateDir = path.join(root, 'state');
	fs.mkdirSync(binDir, { recursive: true });
	const zgPath = path.join(binDir, 'zg');
	fs.writeFileSync(zgPath, STATE_SCRIPT, { mode: 0o755 });
	return {
		binDir,
		stateDir,
		readState: (name) => {
			const file = path.join(stateDir, `${name}.json`);
			return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
		},
		resetState: () => {
			if (!fs.existsSync(stateDir)) return;
			for (const f of fs.readdirSync(stateDir)) {
				if (f.endsWith('.json')) fs.rmSync(path.join(stateDir, f));
			}
		},
		clean: () => fs.rmSync(binDir, { recursive: true, force: true }),
	};
}
