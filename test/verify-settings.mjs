#!/usr/bin/env node
/**
 * Filesystem-only verification for the two-layer zvec-grep config:
 * user file (`~/.pi/agent/pi-zvec-grep/config.json`) + project delta
 * (`.zvec-grep/config.json`), scoped by the user file's `settingsScope`.
 * Mirrors pi-shepherd's verify-settings.mjs contract (minus legacy-file
 * migration, which this extension never had).
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
	const { DEFAULT_SETTINGS, loadProjectDelta, loadSettings, projectConfigFile, saveSettings, userConfigFile } = mod;

	assert.equal(userConfigFile(), path.join(home, '.pi', 'agent', 'pi-zvec-grep', 'config.json'), 'user config path honors PI_CODING_AGENT_DIR');

	// --- defaults with no files at all -------------------------------------
	assert.equal(DEFAULT_SETTINGS.settingsScope, 'user');
	assert.equal(loadSettings().defaultLimit, 7, 'missing defaultLimit setting defaults to 7');
	assert.equal(loadSettings().settingsScope, 'user', 'settings scope defaults to user');
	assert.equal(loadSettings().autoIndex, false, 'autoIndex defaults to off');

	// --- user layer persistence (full object, incl. scope) ------------------
	const user = { ...DEFAULT_SETTINGS, defaultLimit: 10 };
	saveSettings(user, 'user');
	assert.equal(loadSettings().defaultLimit, 10, 'changed defaultLimit persists');
	assert.equal(loadSettings().autoIndex, false, 'autoIndex stays off through user-layer writes');
	const rawUser = JSON.parse(fs.readFileSync(userConfigFile(), 'utf8'));
	assert.equal(rawUser.defaultLimit, 10, 'user file holds the full object');
	assert.equal(rawUser.settingsScope, 'user', 'user file always carries settingsScope');

	// --- project overlay: hand-written delta over the user layer ------------
	const cwd = path.join(home, 'proj');
	fs.mkdirSync(cwd, { recursive: true });
	saveSettings({ ...user, settingsScope: 'project' }, 'user');
	const projFile = projectConfigFile(cwd);
	fs.mkdirSync(path.dirname(projFile), { recursive: true });
	fs.writeFileSync(projFile, JSON.stringify({ defaultLimit: 25 }));
	const merged = loadSettings(cwd);
	assert.equal(merged.defaultLimit, 25, 'project delta overrides the user defaultLimit value');
	assert.equal(merged.settingsScope, 'project', 'effective scope stays the user layer\'s scope');
	assert.equal(loadSettings().defaultLimit, 10, 'no cwd: pure user layer');

	// --- delta-only writes (never settingsScope, only fields that differ) ----
	let result = saveSettings({ ...merged, defaultLimit: 42 }, 'project', cwd);
	assert.equal(result.created, false, 'existing project file: created stays false');
	const rawDelta = JSON.parse(fs.readFileSync(projFile, 'utf8'));
	assert.deepEqual(rawDelta, { defaultLimit: 42 }, 'project file contains only the user-differing fields');
	assert.ok(!('settingsScope' in rawDelta), 'settingsScope is never written to the project file');

	result = saveSettings({ ...user, settingsScope: 'project' }, 'project', cwd);
	assert.deepEqual(JSON.parse(fs.readFileSync(projFile, 'utf8')), {}, 'nothing differs -> project file is {}');

	// --- scope switch onto a fresh project dir creates an empty delta --------
	const freshCwd = path.join(home, 'fresh');
	fs.mkdirSync(freshCwd, { recursive: true });
	result = saveSettings({ ...user, settingsScope: 'project' }, 'project', freshCwd);
	assert.ok(result.created, 'missing project file: created flag is set');
	assert.ok(fs.existsSync(projectConfigFile(freshCwd)), 'project file exists after scope switch');
	assert.deepEqual(JSON.parse(fs.readFileSync(projectConfigFile(freshCwd), 'utf8')), {}, 'first project file is an empty delta when menu state equals the user layer');
	assert.equal(loadSettings(freshCwd).defaultLimit, 10, 'empty delta: pure user values');

	// switching scope back to user leaves the project delta in place
	saveSettings({ ...DEFAULT_SETTINGS, defaultLimit: 10, settingsScope: 'user' }, 'user');
	assert.equal(loadSettings(freshCwd).settingsScope, 'user', 'user file owns the scope pointer');

	// --- settingsScope in a project file is ignored --------------------------
	saveSettings({ ...DEFAULT_SETTINGS, settingsScope: 'project' }, 'user');
	fs.writeFileSync(projFile, JSON.stringify({ settingsScope: 'user', defaultLimit: 5 }));
	const ignored = loadSettings(cwd);
	assert.equal(ignored.settingsScope, 'project', 'project file cannot select its own scope');
	assert.equal(ignored.defaultLimit, 5, 'other project fields still apply');

	// --- malformed values fall back cleanly ----------------------------------
	fs.writeFileSync(projFile, JSON.stringify({ defaultLimit: 'lots' }));
	assert.equal(loadSettings(cwd).defaultLimit, DEFAULT_SETTINGS.defaultLimit, 'invalid defaultLimit -> default');
	fs.writeFileSync(projFile, JSON.stringify({ defaultLimit: 999 }));
	assert.equal(loadSettings(cwd).defaultLimit, DEFAULT_SETTINGS.defaultLimit, 'out-of-range defaultLimit -> default (validField rejects)');
	fs.writeFileSync(projFile, 'not json');
	assert.equal(loadSettings(cwd).defaultLimit, DEFAULT_SETTINGS.defaultLimit, 'malformed project file -> user layer');

	// --- autoIndex: layer contract + scope semantics ------------------------
	saveSettings({ ...DEFAULT_SETTINGS, defaultLimit: 10, settingsScope: 'user', autoIndex: true }, 'user');
	assert.equal(loadSettings().autoIndex, true, 'user layer: autoIndex on');
	assert.equal(loadSettings(cwd).autoIndex, true, 'with no project delta, autoIndex comes from the user layer');
	saveSettings({ ...DEFAULT_SETTINGS, defaultLimit: 10, settingsScope: 'project', autoIndex: true }, 'user');
	result = saveSettings({ ...loadSettings(cwd), autoIndex: false }, 'project', cwd);
	assert.equal(result.created, false, 'autoIndex project save reuses the existing project file');
	assert.deepEqual(JSON.parse(fs.readFileSync(projFile, 'utf8')), { autoIndex: false }, 'autoIndex differing from user value enters the project delta');
	assert.equal(loadSettings(cwd).autoIndex, false, 'project delta turns autoIndex off in project scope');
	assert.equal(loadSettings().autoIndex, true, 'project delta does not leak into the user layer');
	saveSettings({ ...DEFAULT_SETTINGS, defaultLimit: 10, settingsScope: 'project', autoIndex: true }, 'user');
	saveSettings({ ...loadSettings(cwd), autoIndex: true }, 'project', cwd);
	assert.deepEqual(JSON.parse(fs.readFileSync(projFile, 'utf8')), {}, 'autoIndex equal to user value leaves an empty delta');
	// hand-written non-boolean, like defaultLimit: only true/false pass validation
	fs.writeFileSync(projFile, JSON.stringify({ autoIndex: 'yes' }));
	assert.equal(loadSettings(cwd).autoIndex, true, 'non-boolean autoIndex falls back to the user layer');
	// leave autoIndex off, keeping the project scope pointer, for the sections below
	saveSettings({ ...DEFAULT_SETTINGS, defaultLimit: 10, settingsScope: 'project', autoIndex: false }, 'user');
	saveSettings({ ...loadSettings(cwd), autoIndex: false }, 'project', cwd);
	assert.equal(loadSettings(cwd).autoIndex, false, 'autoIndex reset to off in both layers');
	assert.equal(loadSettings(cwd).settingsScope, 'project', 'scope pointer left as project for the sections below');

	// --- loadProjectDelta mirrors the effective project layer -----------------
	fs.writeFileSync(projFile, JSON.stringify({ defaultLimit: 30 }));
	assert.equal(loadProjectDelta(cwd).defaultLimit, 30, 'loadProjectDelta reads the project layer');
	assert.equal(loadProjectDelta(cwd).settingsScope, 'project', 'loadProjectDelta reports the user layer\'s scope');

	// --- tool wiring: zvec_search picks up the scoped default limit ----------
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
	fs.writeFileSync(userConfigFile(), JSON.stringify({ settingsScope: 'project', defaultLimit: 11 }));
	fs.mkdirSync(path.join(ws2, '.zvec-grep'), { recursive: true });
	fs.writeFileSync(path.join(ws2, '.zvec-grep', 'config.json'), JSON.stringify({ defaultLimit: 21 }));

	await invokeTool(calls, 'zvec_search', { query: 'wired' }, makeCtx({ cwd: ws2 }));
	const q1 = fake.readState('query');
	assert.equal(q1.args[q1.args.indexOf('--limit') + 1], '21', 'no explicit limit: project delta value is used');

	await invokeTool(calls, 'zvec_search', { query: 'wired', limit: 3 }, makeCtx({ cwd: ws2 }));
	const q2 = fake.readState('query');
	assert.equal(q2.args[q2.args.indexOf('--limit') + 1], '3', 'explicit tool-call limit wins over the config default');

	fs.rmSync(path.join(ws2, '.zvec-grep', 'config.json'));
	await invokeTool(calls, 'zvec_search', { query: 'wired' }, makeCtx({ cwd: ws2 }));
	const q3 = fake.readState('query');
	assert.equal(q3.args[q3.args.indexOf('--limit') + 1], '11', 'project file gone: user-layer default applies');

	console.log('All settings assertions passed.');
} finally {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	fs.rmSync(home, { recursive: true, force: true });
}
