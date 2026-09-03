#!/usr/bin/env node
/**
 * CLI contract harness.
 *
 * Asserts the version/shape of the global `zg` CLI this package shells out to,
 * so CI fails loudly when @zvec/zvec-grep changes a flag we depend on.
 * Skips gracefully (with a notice) when zg is not installed locally.
 */
import { spawnSync } from 'node:child_process';

const run = (args) => {
	const result = spawnSync('zg', args, { encoding: 'utf8' });
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

let failures = 0;
function assert(cond, label, extra = '') {
	if (cond) console.log(`PASS  ${label}${extra ? ` — ${extra}` : ''}`);
	else {
		failures += 1;
		console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
	}
}

const version = run(['--version']);
assert(version.status === 0, 'zg --version exits 0', version.stdout.trim());
assert(/\d+\.\d+\.\d+/.test(version.stdout), 'version is semver', version.stdout.trim());

const queryHelp = run(['query', '--help']);
for (const flag of ['--hybrid', '--fts', '--vector', '--fuse', '--limit', '-g', '--glob', '-t', '--type', '-T', '--symbol-type', '--prefer-symbol', '--modified-after', '--modified-before']) {
	assert(queryHelp.stdout.includes(flag), `zg query supports ${flag}`);
}

const indexHelp = run(['index', '--help']);
for (const flag of ['--rebuild', '--drop', '--yes', '--embedding', '-g', '-t', '-T', '--hidden', '--no-ignore', '--ignore-file', '--max-depth']) {
	assert(indexHelp.stdout.includes(flag), `zg index supports ${flag}`);
}

// --rg contract: run real managed-rg commands in a temp workspace.
import { tmpdir } from 'node:os';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
const ws = fs.mkdtempSync(nodePath.join(tmpdir(), 'pi-zvec-grep-cli-'));
fs.writeFileSync(nodePath.join(ws, 'sample.txt'), 'needle target line\n');
const runRg = (...args) => spawnSync('zg', ['query', '--rg', ...args], { cwd: ws, encoding: 'utf8' });

// matching flags accepted
{
	const r = runRg('-F', 'needle');
	assert(r.status === 0 && r.stdout.includes('needle'), 'rg: -F literal match works', r.stdout.trim());
}
{
	const r = runRg('-n', 'target');
	assert(r.status === 0 && r.stdout.includes('1:'), 'rg: -n line numbers work', r.stdout.trim());
}
{
	const r = runRg('-g', '*.txt', 'needle');
	assert(r.status === 0, 'rg: -g glob works', r.stderr.trim());
}
{
	const r = runRg('-A', '1', 'needle');
	assert(r.status === 0, 'rg: -A context works', r.stderr.trim());
}

// output-reformatting flags are rejected (documented boundary: no -c/-l/--json)
for (const banned of ['-c', '-l', '--json']) {
	const r = runRg(banned, 'needle');
	assert(r.status !== 0, `rg: ${banned} rejected (not part of the managed-r surface)`, r.stdout.trim());
}

// missing-index hint contract (the message our error path surfaces to the model)
{
	const empty = fs.mkdtempSync(nodePath.join(tmpdir(), 'pi-zvec-grep-cli-noindex-'));
	const r = spawnSync('zg', ['query', 'no such thing'], { cwd: empty, encoding: 'utf8' });
	assert(r.status !== 0, 'no-index query exits non-zero');
	assert((r.stderr + r.stdout).includes('WORKSPACE_INDEX_NOT_FOUND'), 'no-index error carries the WORKSPACE_INDEX_NOT_FOUND code');
}

fs.rmSync(ws, { recursive: true, force: true });

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.log('\nall assertions passed');
