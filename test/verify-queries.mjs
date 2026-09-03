#!/usr/bin/env node
/**
 * Query builder harness: buildQueryArgs() argv contract.
 *
 * Pure unit test — no process spawning. The exact flag spellings here are the
 * contract zg query 0.2.x accepts; changing one requires re-reading
 * `zg query --help`.
 */
import * as assert from 'node:assert/strict';
import { buildQueryArgs, DEFAULT_LIMIT } from '../src/core/queries.ts';
import { createReporter } from './helpers/test-utils.mjs';

const { assert: check, done } = createReporter();

function argsOf(params) {
	return buildQueryArgs(params);
}
function after(args, flag) {
	const i = args.indexOf(flag);
	assert.ok(i !== -1, `flag ${flag} present`);
	return args[i + 1];
}

// minimal: positional hybrid query + default limit
let args = argsOf({ query: 'how is auth validated' });
check(args[0] === 'query', 'argv starts with query');
check(args[1] === 'how is auth validated', 'positional query second');
check(args.includes('--limit') && after(args, '--limit') === '7', 'default limit is 7');
check(!args.includes('--fuse'), 'no fuse flag by default');
check(!args.includes('--hybrid'), 'bare query is not routed via --hybrid');

// explicit groups
args = argsOf({
	query: 'primary question',
	queries: ['q1', 'q2'],
	fts: ['AuthService'],
	vector: ['semantic phrase'],
	fuse: true,
	limit: 42,
});
check(args[1] === 'primary question', 'positional query leads');
const hybridValues = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '--hybrid') hybridValues.push(args[i + 1]);
check(JSON.stringify(hybridValues) === JSON.stringify(['q1', 'q2']), 'queries → --hybrid in order', hybridValues.join(','));
const ftsValues = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '--fts') ftsValues.push(args[i + 1]);
check(JSON.stringify(ftsValues) === JSON.stringify(['AuthService']), 'fts → --fts');
const vectorValues = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '--vector') vectorValues.push(args[i + 1]);
check(JSON.stringify(vectorValues) === JSON.stringify(['semantic phrase']), 'vector → --vector');
check(args.includes('--fuse'), 'fuse flag when fuse: true');
check(after(args, '--limit') === '42', 'explicit limit honored');

// filters
args = argsOf({
	query: 'x',
	globs: ['src/**', '!gen/**'],
	fileTypes: ['ts', 'py'],
	excludedFileTypes: ['svg'],
	symbolTypes: ['function'],
	preferSymbol: true,
	modifiedAfter: '2026-01-01',
	modifiedBefore: '2026-07-01',
});
check(args.includes('--prefer-symbol'), 'prefer-symbol flag');
check(after(args, '--symbol-type') === 'function', 'symbol-type flag');
check(after(args, '--modified-after') === '2026-01-01', 'modified-after flag');
check(after(args, '--modified-before') === '2026-07-01', 'modified-before flag');
const globValues = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '-g') globValues.push(args[i + 1]);
check(JSON.stringify(globValues) === JSON.stringify(['src/**', '!gen/**']), 'globs → -g in order');
const typeValues = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '-t') typeValues.push(args[i + 1]);
check(JSON.stringify(typeValues) === JSON.stringify(['ts', 'py']), 'fileTypes → -t');
const excludedTypeValues = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '-T') excludedTypeValues.push(args[i + 1]);
check(JSON.stringify(excludedTypeValues) === JSON.stringify(['svg']), 'excludedFileTypes → -T');

// query-group coverage: at least one required
let threw = '';
try {
	buildQueryArgs({});
} catch (error) {
	threw = String(error.message);
}
check(threw.includes('at least one of'), 'empty query set rejected with clear message', threw);

// vectors-only search is a valid route (no positional query needed)
args = argsOf({ vector: ['meaning-only'] });
check(args[1] === '--vector', 'vector-only argv starts with the group', args.join(' '));

check(DEFAULT_LIMIT === 7, 'DEFAULT_LIMIT constant matches zg default');

done();
