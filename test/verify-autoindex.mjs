#!/usr/bin/env node
/**
 * Behavior contract for the session-start auto-index hook (setting:
 * `autoIndex`, off by default):
 *   - hook is registered on `session_start` and runs for every reason
 *     (no reason filter)
 *   - guard: `zg status --check-ready` first; ready (exit 0) → nothing more
 *   - not ready + autoIndex on → fire-and-forget `zg index <root>`; the hook
 *     itself resolves while the build is still running
 *   - in-flight: concurrent starts in the same cwd yield a single build;
 *     different cwds are independent roots; slot releases after completion
 *   - autoIndex off / missing → the guard never runs
 *   - build failure → error notification path, no throw out of the hook
 * Uses the fake zg + fake pi harness like verify-settings.mjs.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-zvec-grep-autoindex-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(home, '.pi', 'agent');
process.env.ZFAKE_INDEX_SLEEP = '1';

try {
	const { userConfigFile, DEFAULT_SETTINGS } = await import(`../src/extension/config.ts?autoindex-test=${Date.now()}`);
	const { createFakeZg } = await import('./helpers/fake-zg.mjs');
	const { createFakePi, makeCtx, registerSurface } = await import('./helpers/pi-harness.mjs');

	const fake = createFakeZg(home);
	const { pi, calls } = createFakePi({ binDir: fake.binDir, stateDir: fake.stateDir });
	await registerSurface(pi, { includeAutoIndex: true });

	// The hook is part of the surface: exactly one session_start registration.
	assert.ok(calls.events.includes('session_start'), 'session_start handler is registered');
	assert.equal(calls.events.filter((e) => e === 'session_start').length, 1, 'exactly one session_start handler');

	const setAutoIndex = (b) => {
		fs.mkdirSync(path.join(home, '.pi', 'agent', 'pi-zvec-grep'), { recursive: true });
		fs.writeFileSync(userConfigFile(), JSON.stringify({ ...DEFAULT_SETTINGS, autoIndex: b }));
	};

	// --- off (default): the guard never runs ---------------------------------
	{
		fs.mkdirSync(path.join(home, '.pi', 'agent', 'pi-zvec-grep'), { recursive: true });
		fs.writeFileSync(userConfigFile(), JSON.stringify(DEFAULT_SETTINGS)); // explicit off
		const cwd = path.join(home, 'off');
		fs.mkdirSync(cwd, { recursive: true });
		await pi.emit('session_start', { type: 'session_start', reason: 'startup' }, makeCtx({ cwd }));
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(fake.readState('status'), undefined, 'autoIndex off: no status guard call');
		assert.equal(fake.readState('index'), undefined, 'autoIndex off: no index call');
	}

	// --- missing setting: treated as off, on any reason ----------------------
	{
		fs.rmSync(path.join(home, '.pi', 'agent', 'pi-zvec-grep'), { recursive: true, force: true });
		fake.resetState();
		const cwd = path.join(home, 'missing');
		fs.mkdirSync(cwd, { recursive: true });
		await pi.emit('session_start', { type: 'session_start', reason: 'new' }, makeCtx({ cwd }));
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(fake.readState('status'), undefined, 'missing setting (reason "new"): no guard — gating is the setting, not the reason');
	}

	// --- on + guard passes (ready): no index call -----------------------------
	{
		setAutoIndex(true);
		process.env.ZFAKE_MODE = 'ready';
		fake.resetState();
		const cwd = path.join(home, 'ready');
		fs.mkdirSync(cwd, { recursive: true });
		await pi.emit('session_start', { type: 'session_start', reason: 'reload' }, makeCtx({ cwd }));
		await new Promise((r) => setTimeout(r, 100));
		const status = fake.readState('status');
		assert.ok(status, 'autoIndex on + ready: the guard ran');
		assert.deepEqual(status.args, ['--check-ready'], 'guard argv is `zg status --check-ready` (fake records subcommand separately)');
		assert.equal(status.cwd, cwd, 'guard cwd is the session cwd (index root = cwd)');
		assert.equal(fake.readState('index'), undefined, 'guard exit 0: no index call');
	}

	// --- on + guard fails (stale): fire-and-forget index --------------------
	process.env.ZFAKE_MODE = 'stale-slow';
	{
		fake.resetState();
		const cwd = path.join(home, 'stale');
		fs.mkdirSync(cwd, { recursive: true });
		const started = pi.emit('session_start', { type: 'session_start', reason: 'resume' }, makeCtx({ cwd }));
		assert.deepEqual(await started, [undefined], 'handler returns undefined (no cancel semantics)');
		assert.ok(!fs.existsSync(path.join(fake.stateDir, 'index.json')), 'fire-and-forget: no index recorded immediately after the hook returns');
		await new Promise((r) => setTimeout(r, 500)); // still building (fake sleeps 1s)
		assert.ok(fake.readState('status'), 'the guard ran first (by the time the build is in flight)');
		assert.ok(!fs.existsSync(path.join(fake.stateDir, 'index.json')), 'hook did not await the build: still in flight mid-way');
		await new Promise((r) => setTimeout(r, 1300)); // settle
		const index = fake.readState('index');
		assert.ok(index, 'guard failed: background index finally ran');
		assert.deepEqual(index.args, [cwd], 'index argv pins the root');
		assert.equal(index.cwd, cwd, 'index cwd is the session cwd');
		assert.ok(calls.exec.some((e) => e.command === 'zg' && e.args[0] === 'index' && e.args[1] === cwd && e.options?.timeout === 600_000), 'index carries the ZG_INDEX timeout');
	}

	// --- in-flight: concurrent starts in one cwd → a single build -------------
	{
		const cwd = path.join(home, 'inflight');
		fs.mkdirSync(cwd, { recursive: true });
		calls.exec.length = 0;
		await Promise.all(
			['startup', 'reload', 'new'].map((reason) => pi.emit('session_start', { type: 'session_start', reason }, makeCtx({ cwd }))),
		);
		await new Promise((r) => setTimeout(r, 500)); // mid-flight
		const buildsMid = calls.exec.filter((e) => e.command === 'zg' && e.args[0] === 'index').length;
		assert.equal(buildsMid, 1, 'mid-flight: exactly one in-flight build');
		await new Promise((r) => setTimeout(r, 1200)); // settle
		const builds = calls.exec.filter((e) => e.command === 'zg' && e.args[0] === 'index');
		assert.equal(builds.length, 1, 'after settling: still a single build');

		// slot released after completion: the next start runs again
		await pi.emit('session_start', { type: 'session_start', reason: 'startup' }, makeCtx({ cwd }));
		await new Promise((r) => setTimeout(r, 1650));
		const buildsAfter = calls.exec.filter((e) => e.command === 'zg' && e.args[0] === 'index').length;
		assert.equal(buildsAfter, 2, 'slot released: a later start starts a fresh build');
	}

	// --- different cwds are independent roots ---------------------------------
	{
		const a = path.join(home, 'ra');
		const b = path.join(home, 'rb');
		fs.mkdirSync(a, { recursive: true });
		fs.mkdirSync(b, { recursive: true });
		calls.exec.length = 0;
		await pi.emit('session_start', { type: 'session_start', reason: 'startup' }, makeCtx({ cwd: a }));
		await pi.emit('session_start', { type: 'session_start', reason: 'startup' }, makeCtx({ cwd: b }));
		await new Promise((r) => setTimeout(r, 1650));
		const builds = calls.exec.filter((e) => e.command === 'zg' && e.args[0] === 'index');
		assert.equal(builds.length, 2, 'per-root in-flight: each cwd gets its own build');
		assert.deepEqual(builds.map((e) => e.args[1]).sort(), [a, b].sort(), 'each build pins its own root');
	}

	// --- build failure: no throw out of the hook ------------------------------
	{
		process.env.ZFAKE_MODE = 'fail-index';
		const cwd = path.join(home, 'fail');
		fs.mkdirSync(cwd, { recursive: true });
		let hookError;
		try {
			await pi.emit('session_start', { type: 'session_start', reason: 'startup' }, makeCtx({ cwd }));
		} catch (error) {
			hookError = error;
		}
		assert.equal(hookError, undefined, 'failed build must not reject the session_start emit');
		await new Promise((r) => setTimeout(r, 300));
		assert.ok(calls.exec.some((e) => e.args[0] === 'index' && e.args[1] === cwd), 'failure path still attempted the build');
	}

	console.log('All auto-index assertions passed.');
} finally {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	delete process.env.ZFAKE_INDEX_SLEEP;
	delete process.env.ZFAKE_MODE;
	fs.rmSync(home, { recursive: true, force: true });
}
