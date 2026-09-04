#!/usr/bin/env node
/**
 * Filesystem-only verification for the two-layer zvec-grep config:
 * user file (`~/.pi/agent/pi-zvec-grep/config.json`, values only) + project
 * file (`.zvec-grep/config.json`), which carries the boolean `projectScope`
 * activation flag.
 *
 * The flag lives in the PROJECT file (per workspace, never the machine):
 * - file exists && projectScope === true (or a legacy settingsScope
 *   "project" string): the file alone is the whole config for THIS
 *   workspace (built-in defaults + its contents; user values are never
 *   mixed in, missing fields fall back to built-in defaults)
 * - otherwise (no file, flag false/absent/invalid, malformed file): user
 *   file over built-in defaults — the file's values stay dormant
 * The USER file is values only: a stray projectScope or a legacy
 * settingsScope key there is ignored and stripped on the next user save.
 * Files the menu manages always carry the flag (deactivation writes
 * false, it never deletes the key or the file).
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-zvec-grep-settings-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(home, '.pi', 'agent');

try {
	const mod = await import(`../src/extension/config.ts?settings-test=${Date.now()}`);
	const { DEFAULT_SETTINGS, deactivateProjectScope, loadProjectFileValues, loadSettings, projectConfigFile, saveSettings, userConfigFile } = mod;

	assert.equal(userConfigFile(), path.join(home, '.pi', 'agent', 'pi-zvec-grep', 'config.json'), 'user config path honors PI_CODING_AGENT_DIR');
	assert.equal(DEFAULT_SETTINGS.projectScope, false, 'default flag is false (user layer)');

	// --- defaults with no files at all -------------------------------------
	assert.equal(loadSettings().defaultLimit, 7, 'no files: defaultLimit is the built-in 7');
	assert.equal(loadSettings().projectScope, false, 'no files: flag false');
	assert.equal(loadSettings().autoIndex, false, 'no files: autoIndex is off');

	// --- user layer persistence (values only — no scope flag) --------------
	saveSettings({ ...DEFAULT_SETTINGS, defaultLimit: 10, autoIndex: true }, 'user');
	const rawUser = JSON.parse(fs.readFileSync(userConfigFile(), 'utf8'));
	assert.deepEqual(rawUser, { defaultLimit: 10, autoIndex: true }, 'user file holds the values only (no projectScope flag)');
	assert.equal(loadSettings().defaultLimit, 10, 'user value applies');
	assert.equal(loadSettings().autoIndex, true, 'user autoIndex on');
	assert.equal(loadSettings().projectScope, false, 'flag stays false in user scope');

	// --- scope keys in the USER file are noise: ignored + stripped ----------
	const legacyCwd = path.join(home, 'legacy');
	fs.mkdirSync(legacyCwd, { recursive: true });
	fs.writeFileSync(userConfigFile(), JSON.stringify({ settingsScope: 'project', defaultLimit: 10, autoIndex: true }));
	assert.equal(loadSettings(legacyCwd).projectScope, false, 'legacy user-file settingsScope=project is a no-op');
	fs.writeFileSync(userConfigFile(), JSON.stringify({ projectScope: true, defaultLimit: 10, autoIndex: true }));
	assert.equal(loadSettings(legacyCwd).projectScope, false, 'stray user-file projectScope flag is a no-op (flag is project-file-only)');
	saveSettings({ ...DEFAULT_SETTINGS, defaultLimit: 10, autoIndex: true }, 'user');
	assert.deepEqual(JSON.parse(fs.readFileSync(userConfigFile(), 'utf8')), { defaultLimit: 10, autoIndex: true }, 'user save strips every scope key');

	const cwd = path.join(home, 'proj');
	fs.mkdirSync(cwd, { recursive: true });
	const projFile = projectConfigFile(cwd);
	const otherCwd = path.join(home, 'other');
	fs.mkdirSync(otherCwd, { recursive: true });

	// --- no project file: user layer applies --------------------------------
	assert.equal(loadSettings(cwd).projectScope, false, 'no project file: flag false');
	assert.equal(loadSettings(cwd).defaultLimit, 10, 'no project file: user defaultLimit applies');
	assert.equal(loadSettings(cwd).autoIndex, true, 'no project file: user autoIndex applies');

	// --- project file, flag false: dormant (user layer applies) -------------
	fs.mkdirSync(path.dirname(projFile), { recursive: true });
	fs.writeFileSync(projFile, JSON.stringify({ projectScope: false, defaultLimit: 25, autoIndex: false }));
	const dorm = loadSettings(cwd);
	assert.equal(dorm.projectScope, false, 'flag false: dormant');
	assert.equal(dorm.defaultLimit, 10, 'dormant file: user value applies, not the file\'s 25');
	assert.equal(dorm.autoIndex, true, 'dormant file: user value applies');

	// --- legacy keyless project file: dormant ----
	fs.writeFileSync(projFile, JSON.stringify({ defaultLimit: 25 }));
	assert.equal(loadSettings(cwd).projectScope, false, 'keyless legacy project file: not activated');
	assert.equal(loadSettings(cwd).defaultLimit, 10, 'keyless legacy file: user value applies');

	// --- invalid flag value: dormant -----------------------------------------
	fs.writeFileSync(projFile, JSON.stringify({ projectScope: 'yes', defaultLimit: 25 }));
	assert.equal(loadSettings(cwd).projectScope, false, 'non-boolean flag: not activated (no crash)');
	assert.equal(loadSettings(cwd).defaultLimit, 10, 'non-boolean flag: user value applies');

	// --- project file, flag true: self-contained activation of THIS workspace
	fs.writeFileSync(projFile, JSON.stringify({ projectScope: true, defaultLimit: 25 }));
	const active = loadSettings(cwd);
	assert.equal(active.projectScope, true, 'flag true: activated for this workspace');
	assert.equal(active.defaultLimit, 25, 'activated: file value is authoritative');
	assert.equal(active.autoIndex, false, 'activated: missing field -> BUILT-IN default (off), not the user layer\'s on');
	assert.equal(loadSettings().projectScope, false, 'activation is per-workspace: no-cwd resolution untouched');
	assert.equal(loadSettings(otherCwd).projectScope, false, 'another workspace: unaffected by this repo\'s flag');
	assert.equal(loadSettings(otherCwd).defaultLimit, 10, 'another workspace: user values apply there');

	// --- legacy settingsScope "project" string activates (read-only compat) -
	fs.writeFileSync(projFile, JSON.stringify({ settingsScope: 'project', defaultLimit: 25 }));
	assert.equal(loadSettings(cwd).projectScope, true, 'legacy settingsScope "project" honoured as true');
	assert.equal(loadSettings(cwd).defaultLimit, 25, 'legacy flag: file values apply');

	// --- malformed project file falls back to the user layer -----------------
	fs.writeFileSync(projFile, 'not json');
	assert.equal(loadSettings(cwd).projectScope, false, 'malformed project file: user layer applies');
	assert.equal(loadSettings(cwd).defaultLimit, 10, 'malformed project file: user value applies');

	// --- full-project writes (values + boolean flag) -------------------------
	let result = saveSettings({ ...DEFAULT_SETTINGS, projectScope: true, defaultLimit: 42 }, 'project', cwd);
	assert.equal(result.created, false, 'malformed file still exists: created stays false');
	assert.deepEqual(JSON.parse(fs.readFileSync(projFile, 'utf8')), { defaultLimit: 42, autoIndex: false, projectScope: true }, 'project file is values + the boolean flag');
	assert.equal(loadSettings(cwd).projectScope, true, 'project save activates this workspace');
	assert.equal(loadSettings(cwd).defaultLimit, 42, 'project save applies the file values');

	// first save in a fresh dir creates the file (flag true)
	const freshCwd = path.join(home, 'fresh');
	fs.mkdirSync(freshCwd, { recursive: true });
	result = saveSettings({ ...DEFAULT_SETTINGS, projectScope: true, defaultLimit: 30 }, 'project', freshCwd);
	assert.ok(result.created, 'missing project file: created flag is set');
	assert.deepEqual(JSON.parse(fs.readFileSync(projectConfigFile(freshCwd), 'utf8')), { defaultLimit: 30, autoIndex: false, projectScope: true }, 'first project file: values + flag');
	assert.equal(loadSettings(cwd).projectScope, true, 'freshCwd activation does not leak into the other workspace');

	// deactivating in one workspace never touches another's file
	assert.ok(fs.existsSync(projectConfigFile(freshCwd)), 'freshCwd file untouched by other deactivations');

	// --- deactivation: flag false, values preserved, legacy key dropped -----
	const de = deactivateProjectScope(cwd);
	assert.equal(de.changed, true, 'deactivateProjectScope reports a change');
	assert.deepEqual(JSON.parse(fs.readFileSync(projFile, 'utf8')), { defaultLimit: 42, autoIndex: false, projectScope: false }, 'deactivation sets the flag false and keeps the values');
	assert.equal(loadSettings(cwd).projectScope, false, 'deactivated: flag false again');
	assert.equal(loadSettings(cwd).defaultLimit, 10, 'deactivated: user value applies again');
	assert.ok(fs.existsSync(projFile), 'deactivation never deletes the file');
	assert.equal(deactivateProjectScope(cwd).changed, false, 'deactivating an already-dormant file: no-op');
	// legacy file (settingsScope string, no flag): deactivation normalizes it
	fs.writeFileSync(projFile, JSON.stringify({ settingsScope: 'project', defaultLimit: 9 }));
	assert.equal(loadSettings(cwd).projectScope, true, 'legacy flag still active before deactivation');
	const de2 = deactivateProjectScope(cwd);
	assert.equal(de2.changed, true, 'deactivation normalizes a legacy-flag file');
	assert.deepEqual(JSON.parse(fs.readFileSync(projFile, 'utf8')), { defaultLimit: 9, projectScope: false }, 'legacy settingsScope key dropped, flag false, values kept');
	assert.deepEqual(deactivateProjectScope(legacyCwd), { changed: false }, 'deactivating a workspace without a project file: no-op, no crash');

	// --- loadProjectFileValues: dormant parked values survive re-activation -
	fs.writeFileSync(projFile, JSON.stringify({ projectScope: false, defaultLimit: 25, autoIndex: false }));
	assert.deepEqual(loadProjectFileValues(cwd), { defaultLimit: 25, autoIndex: false }, 'dormant file: its stored values are readable');
	assert.deepEqual(loadProjectFileValues(legacyCwd), { defaultLimit: 7, autoIndex: false }, 'no file: built-in values (menu creates the file fresh)');

	// --- autoIndex: activation semantics -------------------------------------
	fs.writeFileSync(projFile, JSON.stringify({ projectScope: true, defaultLimit: 7, autoIndex: false }));
	assert.equal(loadSettings().autoIndex, true, 'user layer: autoIndex on');
	assert.equal(loadSettings(cwd).autoIndex, false, 'project scope: user autoIndex does NOT leak in — the file has the word');
	// invalid value inside an activated file -> built-in default (off), not user (on)
	fs.writeFileSync(projFile, JSON.stringify({ projectScope: true, defaultLimit: 7, autoIndex: 'yes' }));
	assert.equal(loadSettings(cwd).autoIndex, false, 'invalid autoIndex in an activated file -> built-in default, not the user layer');
	// leave the project side off for the tool wiring section
	saveSettings({ ...DEFAULT_SETTINGS, projectScope: true, defaultLimit: 7, autoIndex: false }, 'project', cwd);

	// --- tool wiring: zvec_search picks up the per-workspace flag ------------
	// (fresh pi surface import; config module instance is separate but reads
	// the same files; PI_CODING_AGENT_DIR already points at the temp home)
	const { createFakeZg } = await import('./helpers/fake-zg.mjs');
	const { createFakePi, makeCtx, invokeTool, registerSurface } = await import('./helpers/pi-harness.mjs');
	const fakeRoot = fs.mkdtempSync(path.join(home, 'fakezg-'));
	const fake = createFakeZg(fakeRoot);
	const { pi, calls } = createFakePi({ binDir: fake.binDir, stateDir: fake.stateDir });
	await registerSurface(pi);
	const ws2 = path.join(home, 'ws2');
	fs.mkdirSync(ws2, { recursive: true });
	// User layer defaultLimit 11 must be IRRELEVANT while ws2's flag is true
	// (file defaultLimit 21); false (or no file) brings 11 back.
	fs.writeFileSync(userConfigFile(), JSON.stringify({ defaultLimit: 11, autoIndex: true }));
	fs.mkdirSync(path.join(ws2, '.zvec-grep'), { recursive: true });
	const ws2File = path.join(ws2, '.zvec-grep', 'config.json');
	fs.writeFileSync(ws2File, JSON.stringify({ projectScope: true, defaultLimit: 21 }));

	await invokeTool(calls, 'zvec_search', { query: 'wired' }, makeCtx({ cwd: ws2 }));
	const q1 = fake.readState('query');
	assert.equal(q1.args[q1.args.indexOf('--limit') + 1], '21', 'flag true: file value used (user 11 ignored)');

	await invokeTool(calls, 'zvec_search', { query: 'wired', limit: 3 }, makeCtx({ cwd: ws2 }));
	const q2 = fake.readState('query');
	assert.equal(q2.args[q2.args.indexOf('--limit') + 1], '3', 'explicit tool-call limit wins over the config default');

	deactivateProjectScope(ws2);
	assert.deepEqual(JSON.parse(fs.readFileSync(ws2File, 'utf8')), { defaultLimit: 21, projectScope: false }, 'deactivation wrote the boolean flag, not a delete');
	await invokeTool(calls, 'zvec_search', { query: 'wired' }, makeCtx({ cwd: ws2 }));
	const q3 = fake.readState('query');
	assert.equal(q3.args[q3.args.indexOf('--limit') + 1], '11', 'flag false: user value applies again');

	fs.rmSync(ws2File);
	await invokeTool(calls, 'zvec_search', { query: 'wired' }, makeCtx({ cwd: ws2 }));
	const q4 = fake.readState('query');
	assert.equal(q4.args[q4.args.indexOf('--limit') + 1], '11', 'project file gone: user value applies');

	console.log('All settings assertions passed.');
} finally {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	fs.rmSync(home, { recursive: true, force: true });
}
