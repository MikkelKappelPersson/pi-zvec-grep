/**
 * pi-zvec-grep persisted configuration — two layers:
 *
 * - User layer: `~/.pi/agent/pi-zvec-grep/config.json` (via `getAgentDir()`;
 *   `PI_CODING_AGENT_DIR` overridable). Values only — the base defaults for
 *   every workspace that has NOT activated project scope. The user file
 *   never carries a scope flag; legacy keys (`settingsScope`, a stray
 *   `projectScope`) are ignored by readers and stripped on the next
 *   user-layer save.
 * - Project layer: `.zvec-grep/config.json`, anchored at the current working
 *   directory (the same `.zvec-grep` root the workspace index already uses;
 *   no walk-up). Self-contained values plus the boolean activation flag
 *   `projectScope` — true: this file is the whole config for THIS workspace
 *   (built-in defaults + its contents, no user values mixed in, fields
 *   missing from the file falling back to the built-in defaults);
 *   false: the values are stored but dormant and the user layer applies.
 *   Files the menu manages always carry the flag, so a committed file
 *   declares its state explicitly. A repo can only ever flip the settings
 *   of its own workspace, never the machine. (A legacy
 *   `settingsScope: "project"` string in an old project file is honoured
 *   like `projectScope: true`; no other string value activates.)
 *
 * These are the *defaults* used when a tool call doesn't pass an explicit
 * value. Files are read fresh (with a cheap per-file mtime cache) so edits
 * made from the `/zg settings` menu take effect immediately.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

/**
 * Persistent VALUE fields — both layers store them in full. The user file
 * holds ONLY these fields; the project file holds these fields plus the
 * boolean `projectScope` activation flag.
 */
const OVERRIDABLE_FIELDS = ['defaultLimit', 'autoIndex'] as const;
type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/** The persistable value fields of the settings object. */
type SettingsValues = Pick<ZvecGrepSettings, OverridableField>;

export interface ZvecGrepSettings {
	/**
	 * Effective source for the CURRENT workspace: true when that workspace's
	 * project file carries `projectScope: true` (the file alone is
	 * authoritative), false otherwise (user layer applies). Derived per
	 * workspace; never meaningful in the user file.
	 */
	projectScope: boolean;
	/** Default max items per search group (1..50) when a search passes no explicit limit. */
	defaultLimit: number;
	/**
	 * On every session start, run `zg status --check-ready` in the working
	 * directory; when the index is missing or stale, build/update it in the
	 * background (fire-and-forget). Off by default — the first index build can
	 * take a while and may download the local embedding model.
	 */
	autoIndex: boolean;
}

export const DEFAULT_SETTINGS: ZvecGrepSettings = {
	projectScope: false,
	defaultLimit: 7,
	autoIndex: false,
};

export function userConfigFile(): string {
	// getAgentDir() resolves the active agent dir (~/.pi/agent by default,
	// overridable via the PI_CODING_AGENT_DIR env var). A named per-extension
	// subdir sits next to pi's own top-level files (settings.json, sessions/).
	return path.join(getAgentDir(), 'pi-zvec-grep', 'config.json');
}

export function projectConfigFile(projectRoot: string): string {
	return path.resolve(projectRoot, '.zvec-grep', 'config.json');
}

function validDefaultLimit(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 50 ? Math.round(v) : DEFAULT_SETTINGS.defaultLimit;
}

interface LayerCacheEntry {
	mtimeMs: number;
	/** Validated known fields actually present in the file (no defaults). */
	partial: Partial<ZvecGrepSettings>;
}

/** Per-file mtime cache: a read is skipped only when the file is unchanged. */
const layerCache = new Map<string, LayerCacheEntry>();

/**
 * Validate the on-disk value of one known field, or return undefined when the
 * field is absent or invalid (invalid falls through to the layer below).
 */
function validField(field: OverridableField, raw: Record<string, unknown>): unknown {
	switch (field) {
		case 'defaultLimit':
			return typeof raw[field] === 'number' ? validDefaultLimit(raw[field]) : undefined;
		case 'autoIndex':
			return typeof raw[field] === 'boolean' ? raw[field] : undefined;
	}
}

/**
 * The boolean activation flag: `projectScope` when it is a real boolean; a
 * legacy project-file `settingsScope: "project"` string is honoured as true
 * (read-only compatibility — never written). Anything else → undefined
 * (treated as inactive).
 */
function validScopeFlag(raw: Record<string, unknown>): boolean | undefined {
	if (typeof raw.projectScope === 'boolean') return raw.projectScope;
	return raw.settingsScope === 'project' ? true : undefined;
}

function validateLayer(raw: unknown): Partial<ZvecGrepSettings> | undefined {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
	const record = raw as Record<string, unknown>;
	const partial: Partial<ZvecGrepSettings> = {};
	const flag = validScopeFlag(record);
	if (flag !== undefined) partial.projectScope = flag;
	for (const field of OVERRIDABLE_FIELDS) {
		const value = validField(field, record);
		if (value !== undefined) (partial as Record<string, unknown>)[field] = value;
	}
	return partial;
}

/**
 * Read one config file (user or project layer) and return the validated
 * fields that are actually present. Missing, unreadable, or invalid files
 * yield a pure default layer (undefined).
 */
function readPartialLayer(file: string): Partial<ZvecGrepSettings> | undefined {
	let mtimeMs: number;
	let text: string;
	try {
		mtimeMs = fs.statSync(file).mtimeMs;
		text = fs.readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
	const cached = layerCache.get(file);
	if (cached && cached.mtimeMs === mtimeMs) return cached.partial;
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return undefined;
	}
	const partial = validateLayer(raw);
	if (partial) layerCache.set(file, { mtimeMs, partial });
	return partial;
}

/**
 * Resolve the effective settings for one workspace.
 *
 * The activation lives in the PROJECT file: when `.zvec-grep/config.json`
 * carries `projectScope: true` (or a legacy `settingsScope: "project"`),
 * that file alone is authoritative for THIS workspace — built-in defaults +
 * its contents, user values never mixed in, fields missing from the file
 * falling back to the built-in defaults. In every other case (no file, flag
 * false/absent/invalid, malformed file) the user file over built-in
 * defaults applies. A project file can therefore only ever flip the
 * settings of its own repo, never the machine.
 */
export function loadSettings(cwd?: string): ZvecGrepSettings {
	const user = { ...DEFAULT_SETTINGS, ...readPartialLayer(userConfigFile()) };
	// The flag is project-file-only; a stray flag in the user file is noise.
	user.projectScope = false;
	if (typeof cwd !== 'string' || cwd.length === 0) return user;
	const project = readPartialLayer(projectConfigFile(cwd));
	if (!project?.projectScope) return { ...user, projectScope: false };
	const merged = { ...DEFAULT_SETTINGS, projectScope: true };
	for (const field of OVERRIDABLE_FIELDS) {
		const value = (project as Record<string, unknown>)[field];
		if (value !== undefined) (merged as Record<string, unknown>)[field] = value;
	}
	return merged;
}

/**
 * The stored VALUE fields of the project file (built-in defaults + the
 * file's validated values, flag not included). Lets the settings menu
 * re-activate a dormant file without clobbering its parked values.
 */
export function loadProjectFileValues(projectRoot: string): SettingsValues {
	const project = readPartialLayer(projectConfigFile(projectRoot));
	const out = {} as Record<string, unknown>;
	for (const field of OVERRIDABLE_FIELDS) {
		const value = (project as Record<string, unknown> | undefined)?.[field];
		out[field] = value !== undefined ? value : DEFAULT_SETTINGS[field];
	}
	return out as unknown as SettingsValues;
}

/**
 * Persist a full settings object.
 *
 * - `user`: writes the values only (the flag is project-file-only) — this
 *   also strips legacy/noise keys (`settingsScope`, stray `projectScope`)
 *   from an old user file on the next save.
 * - `project`: writes the values PLUS the boolean `projectScope` flag from
 *   `next` — the file is always self-describing; creates the file and
 *   `.zvec-grep/` dir when missing.
 *
 * `created` is true when a new file was born on disk.
 */
export function saveSettings(next: ZvecGrepSettings, scope: 'user' | 'project' = 'user', projectRoot?: string): { file: string; created: boolean } {
	if (scope === 'project') {
		if (!projectRoot) throw new Error('projectRoot is required to save the project config layer');
		const file = projectConfigFile(projectRoot);
		const existed = fs.existsSync(file);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const full: Record<string, unknown> = { ...valuesToFull(next), projectScope: next.projectScope };
		fs.writeFileSync(file, JSON.stringify(full, null, 2));
		const partial: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(full)) partial[key] = value;
		layerCache.set(file, { mtimeMs: fs.statSync(file).mtimeMs, partial });
		return { file, created: !existed };
	}
	const file = userConfigFile();
	const existed = fs.existsSync(file);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const values = valuesToFull(next);
	fs.writeFileSync(file, JSON.stringify(values, null, 2));
	layerCache.set(file, { mtimeMs: fs.statSync(file).mtimeMs, partial: { ...values } });
	return { file, created: !existed };
}

/**
 * Turn project scope back off for one workspace: set `projectScope` to
 * false in the project file, preserving every other stored value (they stay
 * dormant) and dropping a legacy `settingsScope` key. No-op when the file is
 * missing, malformed, or already deactivated; the file itself is never
 * deleted; never deletes values. The user file applies again immediately.
 */
export function deactivateProjectScope(projectRoot: string): { changed: boolean } {
	const file = projectConfigFile(projectRoot);
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return { changed: false };
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { changed: false };
	const record = raw as Record<string, unknown>;
	if (record.projectScope === false) return { changed: false };
	record.projectScope = false;
	delete record.settingsScope; // legacy key: normalize away on any touch
	fs.writeFileSync(file, JSON.stringify(record, null, 2));
	layerCache.set(file, { mtimeMs: fs.statSync(file).mtimeMs, partial: validateLayer(record) ?? {} });
	return { changed: true };
}

/** The value fields of a settings object, in stable order (no flag). */
function valuesToFull(next: ZvecGrepSettings): SettingsValues {
	const full = {} as Record<string, unknown>;
	for (const field of OVERRIDABLE_FIELDS) full[field] = (next as unknown as Record<string, unknown>)[field];
	return full as unknown as SettingsValues;
}
