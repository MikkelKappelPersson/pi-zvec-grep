/**
 * Settings menu for pi-zvec-grep — rendered inline in the writing field slot,
 * exactly like pi's own `/settings` and pi-shepherd's `/shepherd settings`:
 * a `SettingsList` framed by `DynamicBorder`s. When the command runs, the
 * editor is replaced by the menu; arrows navigate, Enter cycles a value,
 * `/` fuzzy-searches, esc closes and the editor comes back.
 *
 * The first item selects the *settings scope*: "user" (the user file) or
 * "project" (the `.zvec-grep/config.json` delta in the current directory).
 * The menu opens on the merged, effective values, so what it shows is exactly
 * what the system is using. Scope changes always save to the user file (it
 * owns the scope pointer); every other field saves to the current scope's
 * file (the project file stores only the delta).
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
import * as path from 'node:path';
import {
	type ConfigScope,
	type ZvecGrepSettings,
	loadProjectDelta,
	loadSettings,
	saveSettings,
} from './config.ts';

const DEFAULT_LIMIT_CHOICES = [3, 5, 7, 10, 15, 20, 30, 50];
const DEFAULT_LIMIT_DISPLAY = (n: number) => String(n);

/** Translate a settings change (string value from the list) back into state. */
function applyValue(settings: ZvecGrepSettings, id: string, value: string): ZvecGrepSettings {
	const next = { ...settings };
	switch (id) {
		case 'settingsScope':
			next.settingsScope = (value === 'project' ? 'project' : 'user') as ConfigScope;
			break;
		case 'defaultLimit': {
			const n = Number.parseInt(value, 10);
			if (Number.isFinite(n) && n >= 1 && n <= 50) next.defaultLimit = n;
			break;
		}
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

	await ctx.ui.custom(
		(_tui, theme, _kb, done) => {
			const container = new Container();
			// Same framing pi uses for its own /settings menu.
			container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));

			const items: SettingItem[] = [
				{
					id: 'settingsScope',
					label: 'Settings scope',
					description:
						'Where settings values come from and where edits are written: the user file, or the project .zvec-grep/config.json (project values override user values).',
					currentValue: settings.settingsScope,
					values: ['user', 'project'],
				},
				{
					id: 'defaultLimit',
					label: 'Default search limit',
					description: 'Max hits per search group (1-50) when a search passes no explicit limit. An explicit tool-call limit always wins.',
					currentValue: DEFAULT_LIMIT_DISPLAY(settings.defaultLimit),
					values: DEFAULT_LIMIT_CHOICES.map(DEFAULT_LIMIT_DISPLAY),
				},
			];

			const list = new SettingsList(
				items,
				Math.min(items.length + 2, 12),
				getSettingsListTheme(),
				(id, value) => {
					settings = applyValue(settings, id, value);
					// Scope changes always persist to the user file (it owns
					// the scope pointer); every other field saves to the
					// current scope's file, so project saves only store the
					// delta against the user layer.
					const targetScope: ConfigScope = id === 'settingsScope' ? 'user' : settings.settingsScope;
					try {
						const { file, created } = saveSettings(settings, targetScope, cwd);
						if (created) {
							// A just-born project file holds at most the delta
							// of the field being set; reset the in-memory
							// state from it so the menu (which shows
							// effective values) matches disk.
							if (targetScope === 'project') settings = loadProjectDelta(cwd);
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
