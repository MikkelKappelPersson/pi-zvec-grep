#!/usr/bin/env node
/**
 * Index builder harness: buildIndexArgs() argv contract.
 *
 * Pure unit test. Covers the three modes, the --yes safety on drop, embedding
 * pass-through, and file-selection flags.
 */
import { buildIndexArgs } from '../src/core/indexing.ts';
import { createReporter } from './helpers/test-utils.mjs';

const { assert: check, done } = createReporter();

// default: plain index, root as first arg
let args = buildIndexArgs({}, '/w');
check(JSON.stringify(args) === JSON.stringify(['index', '/w']), 'default mode is bare index <root>', args.join(' '));
check(!args.includes('--rebuild'), 'no rebuild flag by default');
check(!args.includes('--drop'), 'no drop flag by default');
check(!args.includes('--embedding') || args.length === 2, 'no embedding flag when omitted');

// explicit index mode behaves like default
args = buildIndexArgs({ root: '/w', mode: 'index' }, '/w');
check(JSON.stringify(args) === JSON.stringify(['index', '/w']), 'mode: index is identical to default');

// rebuild
args = buildIndexArgs({ mode: 'rebuild' }, '/w');
check(args.includes('--rebuild'), 'rebuild flag set');
check(!args.includes('--drop'), 'rebuild never drops');

// drop: non-interactive surface must always confirm
args = buildIndexArgs({ mode: 'drop' }, '/w');
check(args.includes('--drop'), 'drop flag set');
check(args.includes('--yes'), 'drop always carries --yes (no interactive prompt possible from a tool call)');
check(!args.includes('--rebuild'), 'drop never rebuilds');

// embedding + filters
args = buildIndexArgs({
	embedding: 'local/potion-code-16m-v2',
	globs: ['src/**', '!node_modules/**'],
	fileTypes: ['ts'],
	excludedFileTypes: ['svg'],
	hidden: true,
}, '/w');
check(args[args.indexOf('--embedding') + 1] === 'local/potion-code-16m-v2', 'embedding pass-through');
const globs = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '-g') globs.push(args[i + 1]);
check(JSON.stringify(globs) === JSON.stringify(['src/**', '!node_modules/**']), 'globs in order');
check(args[args.indexOf('-t') + 1] === 'ts', 'include type');
check(args[args.indexOf('-T') + 1] === 'svg', 'exclude type');
check(args.includes('--hidden'), 'hidden flag');

// hidden omitted → no flag
args = buildIndexArgs({}, '/w');
check(!args.includes('--hidden'), 'hidden omitted by default');

// root always present as first arg, whatever else is set
args = buildIndexArgs({ mode: 'rebuild', embedding: 'x', hidden: true }, '/deep/w');
check(args[0] === 'index' && args[1] === '/deep/w', 'root is always first arg', args.join(' '));

done();
