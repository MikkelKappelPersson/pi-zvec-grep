/**
 * pi-zvec-grep persisted configuration — two layers (same concept as
 * pi-shepherd's config model):
 *
 * - User layer: `~/.pi/agent/pi-zvec-grep/config.json` (via `getAgentDir()`;
 *   `PI_CODING_AGENT_DIR` overridable). Holds the base defaults plus
 *   `settingsScope`, which points out where the effective values come from.
 * - Project layer: `.zvec-grep/config.json`, anchored at the current working
 *   directory (the same `.zvec-grep` root the workspace index already uses;
 *   no walk-up). It is a *delta*: only fields that differ from the user layer
 *   are written, and every field present overrides the user layer one by one.
 *   `settingsScope` is never read from (or written to) the project layer.
 *
 * These are the *defaults* used when a tool call doesn't pass an explicit
 * value. Files are read fresh (with a cheap per-file mtime cache) so edits
 * made from the `/zg settings` menu take effect immediately.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

/** Where the settings menu reads its values from and writes its edits to. */
export type ConfigScope = 'user' | 'project';

/**
 * Overridable config fields — every field except `settingsScope`, which lives
 * only in the user layer (a project file cannot select its own scope).
 */
const OVERRIDABLE_FIELDS = ['defaultLimit'] as const;
type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

export interface ZvecGrepSettings {
	/** Where the effective values come from. Lives only in the user file. */
	settingsScope: ConfigScope;
	/** Default max items per search group (1..50) when a search passes no explicit limit. */
	defaultLimit: number;
}

export const DEFAULT_SETTINGS: ZvecGrepSettings = {
	settingsScope: 'user',
	defaultLimit: 7,
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

function validConfigScope(v: unknown): ConfigScope {
	return v === 'user' || v === 'project' ? v : DEFAULT_SETTINGS.settingsScope;
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
	}
}

function validateLayer(raw: unknown): Partial<ZvecGrepSettings> | undefined {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
	const record = raw as Record<string, unknown>;
	const partial: Partial<ZvecGrepSettings> = {};
	partial.settingsScope = validConfigScope(record.settingsScope);
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

/** Overlay a project delta on top of the user layer, one field at a time. */
function overlayProject(user: ZvecGrepSettings, project: Partial<ZvecGrepSettings> | undefined): ZvecGrepSettings {
	if (!project) return user;
	const merged = { ...user };
	for (const field of OVERRIDABLE_FIELDS) {
		const value = project[field];
		if (value !== undefined) (merged as Record<string, unknown>)[field] = value;
	}
	// `settingsScope` is deliberately never overridden by the project layer.
	return merged;
}

/**
 * Resolve the effective settings: the user layer (file or defaults) with the
 * project delta on top when the user layer's `settingsScope` is "project" and
 * a cwd is given.
 */
export function loadSettings(cwd?: string): ZvecGrepSettings {
	const userFile = userConfigFile();
	const user = { ...DEFAULT_SETTINGS, ...readPartialLayer(userFile) };
	if (user.settingsScope !== 'project' || typeof cwd !== 'string' || cwd.length === 0) return user;
	return overlayProject(user, readPartialLayer(projectConfigFile(cwd)));
}

/**
 * Persist a full settings object.
 *
 * - `user`: writes the whole object (including `settingsScope`).
 * - `project`: diffs `next` against the current user layer and writes only
 *   the fields that differ (`{}` when nothing differs); creates the file
 *   and `.zvec-grep/` dir when missing; never writes `settingsScope`.
 *
 * `created` is true when a new file was born on disk.
 */
export function saveSettings(next: ZvecGrepSettings, scope: ConfigScope = 'user', projectRoot?: string): { file: string; created: boolean } {
	if (scope === 'project') {
		if (!projectRoot) throw new Error('projectRoot is required to save the project config layer');
		const file = projectConfigFile(projectRoot);
		const existed = fs.existsSync(file);
		const user = { ...DEFAULT_SETTINGS, ...readPartialLayer(userConfigFile()) };
		const delta: Record<string, unknown> = {};
		const nextRec = next as unknown as Record<string, unknown>;
		const userRec = user as unknown as Record<string, unknown>;
		for (const field of OVERRIDABLE_FIELDS) {
			if (nextRec[field] !== userRec[field]) {
				delta[field] = nextRec[field];
			}
		}
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(delta, null, 2));
		const partial: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(delta)) partial[key] = value;
		layerCache.set(file, { mtimeMs: fs.statSync(file).mtimeMs, partial });
		return { file, created: !existed };
	}
	const file = userConfigFile();
	const existed = fs.existsSync(file);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(next, null, 2));
	layerCache.set(file, { mtimeMs: fs.statSync(file).mtimeMs, partial: { ...next } });
	return { file, created: !existed };
}

/**
 * The currently effective project layer (user layer with `.zvec-grep/
 * config.json` on top), for the settings menu to diff against the user layer.
 */
export function loadProjectDelta(projectRoot: string): ZvecGrepSettings {
	const user = { ...DEFAULT_SETTINGS, ...readPartialLayer(userConfigFile()) };
	return overlayProject(user, readPartialLayer(projectConfigFile(projectRoot)));
}
