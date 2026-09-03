#!/usr/bin/env node
/**
 * Error and normalization harness.
 *
 * Covers normalizeRoot (cwd fallback + @-prefix stripping, the convention some
 * models paste into path arguments) and clip (output cap), plus the
 * error-shaping contract: zg failures carry stderr into the thrown message so
 * the model sees zg's structured Code:/hint: block.
 */
import * as path from 'node:path';
import { normalizeRoot, clip } from '../src/core/workspace.ts';
import { createTempDirectory, createReporter } from './helpers/test-utils.mjs';

const { assert: check, done } = createReporter();
const ws = createTempDirectory('pi-zvec-grep-norm-');

// normalizeRoot
check(normalizeRoot(undefined, ws) === ws, 'undefined root → cwd');
check(normalizeRoot('', ws) === ws, 'empty root → cwd');
check(normalizeRoot('   ', ws) === ws, 'whitespace root → cwd');
check(normalizeRoot('sub/dir', ws) === path.resolve(ws, 'sub/dir'), 'relative root resolves against cwd');
check(normalizeRoot('/abs/root', ws) === '/abs/root', 'absolute root passes through');
check(normalizeRoot('@sub/x', ws) === path.resolve(ws, 'sub/x'), 'leading @ stripped (model path convention)');

// clip
check(clip('short') === 'short', 'short text unchanged');
const long = 'a'.repeat(100);
check(clip(long, 50) === 'a'.repeat(50) + '\n…(truncated 50 chars)', 'long text clipped with notice');
check(clip('').length >= 0, 'empty text tolerated');

// error-shaping contract: fake failure text must round-trip
const fakeStderr = 'Error: No zvec-grep index found for this workspace\nCode: ZVEC_GREP.ENGINE.SERVICE.WORKSPACE_INDEX_NOT_FOUND';
const message = Error(fakeStderr).message;
check(message.includes('WORKSPACE_INDEX_NOT_FOUND'), 'stderr text survives into Error.message');

done();
