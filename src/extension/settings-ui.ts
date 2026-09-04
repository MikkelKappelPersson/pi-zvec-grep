/**
 * Settings menu for pi-zvec-grep — rendered inline in the writing field slot,
 * exactly like pi's own `/settings` and pi-shepherd's `/shepherd settings`:
 * a `SettingsList` framed by `DynamicBorder`s. When the command runs, the
 * editor is replaced by the menu; arrows navigate, Enter cycles a value,
 * `/` fuzzy-searches, esc closes and the editor comes back.
 *
 * The first item selects the *settings scope* for THIS workspace only: the
 * user file, or the `.zvec-grep/config.json` of the current directory.
 * Activation is a boolean flag in the project file itself
 * (`projectScope: true|false`) — a repo can only ever flip the settings of
 * its own workspace, never the machine. Picking "project" saves the project
 * file (creating it if missing) with `projectScope: true` plus the stored
 * values (a dormant file's parked values win over your user values —
 * activating a team file should not overwrite it); picking "user" sets
 * `projectScope: false`, keeping the stored values dormant. Every other
 * field saves to the file selected by the current scope. Menus-managed
 * files always carry the flag, so they describe their own state. The menu
 * opens on the effective values, so what it shows is exactly what the
 * system is using.
 *
 * Alignment note: the SettingsList pads the label column to the widest label
 * (capped at 30). Keep every label ≤ 30 visible chars so the value column
 * stays aligned.
 *
 * Command: `/zg settings` (pi-shepherd's `/shepherd settings` equivalent).
 */

import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { DynamicBorder, getSettingsListTheme } from '@earendil-works/pi-coding-agent';
import { Container, type SettingItem, SettingsList } from '@earendil-works/pi-tui';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	type ZvecGrepSettings,
	deactivateProjectScope,
	loadProjectFileValues,
	loadSettings,
	projectConfigFile,
	saveSettings,
} from './config.ts';

const DEFAULT_LIMIT_CHOICES = [3, 5, 7, 10, 15, 20, 30, 50];
const DEFAULT_LIMIT_DISPLAY = (n: number) => String(n);
const AUTO_INDEX_DISPLAY = (b: boolean) => (b ? 'on' : 'off');

/** Translate a settings change (string value from the list) back into state. */
function applyValue(settings: ZvecGrepSettings, id: string, value: string): ZvecGrepSettings {
	const next = { ...settings };
	switch (id) {
		case 'projectScope':
			// Display state: "user", "user (project file dormant)", "project".
			next.projectScope = value === 'project';
			break;
		case 'defaultLimit': {
			const n = Number.parseInt(value, 10);
			if (Number.isFinite(n) && n >= 1 && n <= 50) next.defaultLimit = n;
			break;
		}
		case 'autoIndex':
			// The menu cycles the two display strings; map them back to on/off.
			next.autoIndex = value === 'on';
			break;
	}
	return next;
}

/** Render + drive the settings menu. */
export async function openSettings(ctx: ExtensionCommandContext): Promise<void> {
	const cwd = ctx.cwd;
	// Keep the in-memory state current while the menu is open. SettingsList can
	// invoke onChange multiple times in one session; applying every change to
	// the initial snapshot would otherwise discard earlier changes.
	let settings = loadSettings(cwd);
	// Display for the scope item: the effective scope for THIS workspace, with
	// a hint when a (dormant) project file exists beside the user layer.
	// The current display string must sit inside `values` so the cycle
	// (indexOf+1) advances to the state we actually want to offer next.
	const refreshScopeDisplay = (items: SettingItem[]) => {
		if (settings.projectScope) {
			items[0].currentValue = 'project';
			items[0].values = ['project', 'user'];
		} else if (fs.existsSync(projectConfigFile(cwd))) {
			items[0].currentValue = 'user (project file dormant)';
			items[0].values = ['user (project file dormant)', 'project'];
		} else {
			items[0].currentValue = 'user';
			items[0].values = ['user', 'project'];
		}
	};

	await ctx.ui.custom(
		(_tui, theme, _kb, done) => {
			const container = new Container();
			// Same framing pi uses for its own /settings menu.
			container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));

			const items: SettingItem[] = [
				{
					id: 'projectScope',
					label: 'Settings scope',
					description:
						'Settings source for THIS workspace only (never the machine): the user file, or the project .zvec-grep/config.json, ' +
						'a self-contained config (user values are not mixed in; a committed file activates its own repo).',
					currentValue: settings.projectScope ? 'project' : 'user',
					values: ['user', 'project'],
				},
				{
					id: 'defaultLimit',
					label: 'Default search limit',
					description:
						'Max hits per search group (1-50) when a search passes no explicit limit. An explicit tool-call limit always ' +
						'wins. Saved to the file selected by the scope above.',
					currentValue: DEFAULT_LIMIT_DISPLAY(settings.defaultLimit),
					values: DEFAULT_LIMIT_CHOICES.map(DEFAULT_LIMIT_DISPLAY),
				},
				{
					id: 'autoIndex',
					label: 'Auto index on start',
					description:
						'On every session start in this workspace (or the user default when scope is "user"), ' +
						'check the index with `zg status --check-ready` and, when it is missing or stale, build/update it in the ' +
						'background. Off by default — the first index build can take a while and may download the embedding model.',
					currentValue: AUTO_INDEX_DISPLAY(settings.autoIndex),
					values: ['on', 'off'],
				},
			];
			refreshScopeDisplay(items);

			const list = new SettingsList(
				items,
				Math.min(items.length + 2, 12),
				getSettingsListTheme(),
				(id, value) => {
					settings = applyValue(settings, id, value);
					if (id === 'projectScope') {
						// Activation is per project and lives in the project
						// file: "project" -> write the file with the flag
						// true (creating if missing); "user" -> write the
						// flag false (values stay dormant, file is never
						// deleted). The user file is never touched.
						try {
							if (value === 'project') {
								// Preserve a dormant file's parked values:
								// activating a team file must not overwrite
								// it with the local user values.
								settings = { ...settings, ...loadProjectFileValues(cwd) };
								const { file, created } = saveSettings(settings, 'project', cwd);
								if (created) ctx.ui?.notify?.(`Config created at ${path.relative(cwd, file) || file}`, 'info');
								else ctx.ui?.notify?.(`Project scope activated for ${path.basename(cwd)}`, 'info');
							} else {
								const { changed } = deactivateProjectScope(cwd);
								ctx.ui?.notify?.(changed ? 'Project scope deactivated (flag set to false)' : `projectScope = ${value}`, 'info');
							}
						} catch (error) {
							ctx.ui?.notify?.(
								`pi-zvec-grep: could not save ${id}: ${String((error as Error)?.message ?? error)}`,
								'error',
							);
							return;
						}
					} else {
						// Every other field saves to the file the current
						// scope selects: the user file, or the project file
						// (self-contained full object + boolean flag).
						const targetScope: 'user' | 'project' = settings.projectScope ? 'project' : 'user';
						try {
							const { file, created } = saveSettings(settings, targetScope, cwd);
							if (created) {
								ctx.ui?.notify?.(`Config created at ${path.relative(cwd, file) || file}`, 'info');
								return;
							}
							ctx.ui?.notify?.(`${id} = ${value}`, 'info');
						} catch (error) {
							ctx.ui?.notify?.(
								`pi-zvec-grep: could not save ${id}: ${String((error as Error)?.message ?? error)}`,
								'error',
							);
						}
					}
					// Resync from disk so the next change applies to the
					// latest effective values, and refresh the scope display.
					settings = loadSettings(cwd);
					refreshScopeDisplay(items);
					list.invalidate();
				},
				() => done(undefined), // close menu
				{ enableSearch: true },
			);
			container.addChild(list);

			container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));

			return {
				render: (w) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data) => list.handleInput?.(data),
			};
		},
		// No `overlay` — renders inline in the writing-field slot (editor is
		// replaced by the menu and restored on close), like pi's own /settings.
	);
}
