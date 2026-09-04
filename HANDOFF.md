# Handoff — pi-zvec-grep

Repo: `/home/mikkelkp/.pi/agent/extensions/pi-zvec-grep` → remote `https://github.com/MikkelKappelPersson/pi-zvec-grep.git`
npm target: `@luminascale/pi-zvec-grep` (v0.2.0)

## What this is

A pi extension (package format, same layout as sibling `pi-shepherd`) that exposes the
global `zg` CLI ([zvec-grep](https://github.com/zvec-ai/zvec-grep)) as three native pi
tools plus a `/zg` slash command (index / rebuild / drop / status / help).
No MCP server involved — everything shells out to `zg`
via `pi.exec`.

Surfaces:
- `zvec_search` — hybrid semantic+keyword search over an indexed workspace (query groups,
  fuse, globs, file types, symbol focus, mtime filters, optional `root`)
- `zvec_index` — index / rebuild / drop a workspace (local embedding models recommended)
- `zvec_status` — index presence/coverage/freshness; missing index is a normal state
- `/zg <index|rebuild|drop|status|help> [path]` — one command with subcommand args and
  argument completion; bare `/zg` shows usage

Design rule baked into tool descriptions: `zvec_search` = meaning/fuzzy/unknown-location
questions; plain `rg` stays for exact strings, counts, file lists, pipes (zg's managed
`--rg` intentionally can't do those).

## State: DONE and VERIFIED

- Layout mirrors pi-shepherd: `index.ts` entry → `src/core/` (pure argv/normalization helpers)
  → `src/extension/tools.ts` (pi surface). No runtime imports in `src/core/`.
- `npm test` — all 6 suites green:
  - `verify-cli.mjs` — real `zg` 0.2.1 contract (query/index flags, managed `--rg` accepted
    flags, rejected output-format flags `-c/-l/--json`, no-index error code)
  - `verify-surface.mjs` — real `index.ts` against fake pi + fake `zg` on PATH: registration,
    schemas, argv/cwd/signal wiring, drop→`--yes`, error path, timeouts
  - `verify-queries.mjs` / `verify-indexing.mjs` — pure argv-builder contracts
  - `verify-errors.mjs` — normalizeRoot (cwd fallback, `@`-strip) + clip + error shaping
  - `verify-format.mjs` — zg output parsers (search summary, status verdict, hit headline)
    against captured real output; unrecognized input → undefined, never throws
- Hermetic by design: tests need no real index/network; only `verify-cli` needs `zg`
  installed (it is: 0.2.1 globally).
- E2E through pi's **actual** jiti loader + pi aliases + real zg: register → no-index throw
  with `WORKSPACE_INDEX_NOT_FOUND` hint → real index build → semantic search hit → status ready.
  (Verified in a temp workspace; model: local/potion-code-16m-v2.)
- `npm pack --dry-run`: 19 files, clean tarball, no node_modules.
- devDeps installed in-repo (pi-coding-agent 0.84.4, pi-tui 0.84.4, typebox 1.3.7) —
  same pattern pi-shepherd uses so plain `node --experimental-strip-types` resolves pi imports.
- CI: `.github/workflows/publish.yml` copied from pi-shepherd (trusted publishing: tag
  release → `npm ci` → `npm test` → `npm publish --access public --provenance`).
- LICENSE (Apache-2.0, copied template), README, .gitignore, .prettierrc in place.
- Committed + pushed to origin (see `git log`).

## TUI rendering (shipped in v0.2.0)

- `src/core/format.ts` — pi-free parsers for zg's human output:
  - `parseSearchOutput` → `{ groups, totalHits, fileCount, top: ZgHit, hasStale }` (single/multi group, zero hits)
  - `parseStatusVerdict` → `ready | needs-update | missing` one-liner (parses block header + Changes line)
  - `hitHeadline` — `FILE:lines — heading|symbol|preview` (label over preview, clipped)
  - Contract: unrecognized shape → `undefined` → renderers fall back to raw dim preview; never throw.
- `tools.ts` renderers, built on pi's standard theming (pending/success/error background comes
  free from the default Box shell):
  - All `renderCall`s: bold tool name (`toolTitle`) + accent primary arg + dim filters/limit,
    `context.lastComponent` reuse; zvec_index colors `rebuild` warning / `drop` error.
  - `zvec_search.renderResult` — collapsed: `✓ N hits · M files [· stale] (⏎ to expand)` in
    success/warning + top-hit headline dimmed; expanded: styled raw output (hit refs accent,
    matchedBy/metadata dim, truncation warning); errors: head line in `error` color, rest on expand.
  - `zvec_status.renderResult` — collapsed: color-coded verdict (success/warning/muted-dim);
    expanded: full toolOutput block. Missing index renders as muted verdict, not error.
  - `zvec_index.renderResult` — live elapsed timer while partial (bash-renderer
    startedAt/setInterval/invalidate pattern), then `✓ index updated · N files · M entities · Xs`
    with the added/modified/deleted delta dimmed; expanded: styled finish block.
    `parseIndexOutput` in core/format.ts feeds it (drop-mode output → undefined → dim preview).
  - `keyHint('app.tools.expand')` is the expand hint (deferred call — module import must not touch
    pi's theme, which breaks the hermetic node test loader).
  - Structured data rides in `details` (`summary` / `verdict`) so session state survives re-renders
    and branching; renderers also re-parse `content` text as fallback for old sessions.
- Remaining (known good next steps): path shortening in call lines (built-in
  `~/…` convention).

## Settings (added after v0.2.1, released in v0.3.0)

- `/zg settings` — scoped settings menu copied straight from pi-shepherd's
  concept (`/shepherd settings`): first item **Settings scope** (user/project),
  then the fields. Same two-layer config model:
  - user layer `~/.pi/agent/pi-zvec-grep/config.json` — full object incl.
    `settingsScope` (the scope pointer lives only here).
  - project layer `.zvec-grep/config.json` (cwd-anchored, no walk-up — same root
    as the workspace index) — *delta* only; fields override user one-by-one;
    `settingsScope` never read from / written to it.
- Settings fields (for now, exactly one): **Default search limit** (1–50) —
  wired into `zvec_search` (explicit tool-call `limit` always wins; scoped
  default otherwise; hard cap 50). Menu writes follow scope; switching to
  project scope creates the file + `Config created at .zvec-grep/config.json`
  notification, mirroring shepherd. Non-interactive runs: `/zg settings`
  warns instead of opening the TUI menu.
- Files: `src/extension/config.ts` (copy-paste of shepherd's config.ts
  patterns, minus timeout/stale-wait migration and the legacy
  `settings.json`→`config.json` migration this package never had),
  `src/extension/settings-ui.ts` (same SettingsList/DynamicBorder/inline-slot
  pattern), `tools.ts` parser gains the `settings` subcommand (no root arg).
- Tests: `test/verify-settings.mjs` (pure config-layer contract + subprocess
  tool-wiring: user/project/explicit limit resolution); surface suite asserts
  completions + non-UI warning. `npm run settings:test` added to the chain.

## Auto index on session start (released in v0.3.0, 2026-09-03)

- New scoped setting **`autoIndex`** (default `false`): on every `session_start`
  (deliberately no reason filter — the guard makes re-checks free) the hook
  runs `zg status --check-ready` with `cwd = root`; when it exits non-zero
  the hook fires `zg index <root>` in the background — never awaited, never
  throwing into the lifecycle hook — then `ui.notify`s ("index updated" /
  "auto index failed: <first line>"). A per-root in-flight `Set` suppresses
  concurrent builds for the same root; different cwds run independently.
- Wiring: `config.ts` gains `autoIndex` in `OVERRIDABLE_FIELDS` (+ boolean
  validator); `settings-ui.ts` gains the **Auto index on start** item
  (cycles `on`/`off`); `tools.ts` exports `registerAutoIndex(pi)` called from
  `index.ts`.
- Tests: `test/verify-autoindex.mjs` (new suite; fake zg gained
  `stale-slow` (index sleeps `ZFAKE_INDEX_SLEEP`s), `fail-index`, `ready`
  modes + `resetState()`; fake pi `on()` now captures handlers and
  `pi.emit(event, …)` replays them). Contract: off/missing → no guard
  (gating is the setting, not the reason); ready guard → no index call;
  stale guard → guard first, then async `index <cwd>` with the 10-min
  timeout; 3 concurrent starts → exactly one build; slot released after
  completion (next start rebuilds); per-root independence; failed build
  never rejects the emit. `verify-settings.mjs` covers the layer contract
  (default off, user on, project delta on/off, non-boolean fallback, empty
  delta when equal). `verify-surface.mjs` asserts exactly one
  `session_start` registration.
- Verified against real `zg` 0.2.1: `zg status --check-ready` exits 1 on a
  directory without an index and on a stale index (`npm i -g @zvec/zvec-grep`).

## Project settings semantics: final model (unreleased, built after v0.3.0)

Two decisions (2026-09-03), iterating on the v0.3.0 two-layer model:

1. **Delta → self-contained file.** The project layer used to store a *delta*
   against the user layer (only fields differing on the author's machine),
   making a committed file machine-dependent: absent fields silently
   resolved to each teammate's own user values, and present fields could not
   be told apart from personal overrides.
2. **Machine-global → per-workspace activation.** `settingsScope` lived in
   the USER file and applied to every workspace (one global switch: switch
   to project in one repo and every other repo silently ran on defaults or
   its own file). The activation now lives in the PROJECT file itself — and
   in a third refinement inside the same session, as a **boolean** instead
   of a string: a repo can only ever flip the settings of its own
   workspace, never the machine. The user file is values-only.

### Final model

- **User layer** `~/.pi/agent/pi-zvec-grep/config.json` — values only
  (`defaultLimit`, `autoIndex`). No scope flags: a stray `projectScope` key
  is ignored; a legacy `settingsScope` key is ignored and stripped by the
  next user-layer save (both are stripped by `valuesToFull`).
- **Project layer** `.zvec-grep/config.json` (cwd-anchored, no walk-up) —
  self-contained values PLUS the boolean activation flag `projectScope`
  (true = this file is the source of truth for this workspace, false =
  values stored but dormant). Files the menu manages always carry the
  flag, so a committed file declares its state. A legacy
  `settingsScope: "project"` string in an old file is honoured as true
  (read-only; never written).
- **Resolution** (per workspace, per tool call):
  - file exists && flag true (or legacy string) → file alone is
    authoritative for THIS workspace: built-in defaults + its contents,
    user values never mixed in, missing fields → built-in defaults.
  - otherwise (no file, flag false/absent/non-boolean, malformed file) →
    user file over built-in defaults; the project file's values stay
    **dormant**.
- **Menu** (`/zg settings`): the first item is the per-workspace scope, with
  a third display state `user (project file dormant)` when a (flag-false or
  keyless) file exists. Picking `project` saves the file with
  `projectScope: true` plus the values (creates if missing →
  `Config created at …`), and a dormant file's parked values win over the
  local user values (`loadProjectFileValues`) — activating a team file must
  not overwrite it. Picking `user` calls `deactivateProjectScope` — flag
  written false, stored values kept dormant, legacy string key dropped,
  file never deleted, user values apply immediately.
- **Files:** `config.ts` — `ZvecGrepSettings.projectScope: boolean`
  (effective flag; the string-enum `ConfigScope` is gone; `saveSettings`
  takes a plain `'user' | 'project'`); `loadSettings` resolves per
  workspace from the project file's flag (legacy string honoured);
  `saveSettings` user branch writes values only (legacy strip); project
  branch writes values + boolean flag; `deactivateProjectScope` flips the
  flag false (normalizes a legacy key); new `loadProjectFileValues`.
  `settings-ui.ts` — scope item `id: 'projectScope'`, display refresh,
  scope-vs-value save split, dormant-value preservation on activation.
  `tools.ts` — comment only.
- **Tests** (`verify-settings.mjs`, rewritten): flag false / keyless legacy
  / non-boolean flag / malformed file → user layer wins (file 25, user 10 →
  10, values dormant); flag true → file wins with built-in fallback for
  missing fields (user autoIndex `true` does not leak in); per-workspace
  independence (flag in `proj` does not touch `other` or no-cwd); legacy
  `settingsScope: "project"` string activates (read-only); user-file scope
  keys (both legacy and stray boolean) ignored + stripped; deactivation
  writes FALSE not a delete (values kept, legacy key dropped,
  already-false → no-op, no-file → no-op); `loadProjectFileValues`
  (dormant values readable, no file → built-ins); tool wiring: flag true
  (21) beats user (11), explicit limit still wins, deactivate → 11,
  file deleted → 11.
- **Migration notes:**
  - existing delta-style / keyless project files → dormant until the flag is
    added (menu: pick `project`, or hand-edit `"projectScope": true`). No
    crash, no silent change.
  - project files with the earlier string key: `settingsScope: "project"`
    activates exactly as before (read-only compat); deactivation rewrites
    them to the boolean form.
  - user files with `settingsScope` — the key is a no-op immediately; next
    user-layer save strips it. A prior global `"project"` preference is
    lost: each such workspace needs its own project file with the flag.
- **Gotcha (README):** repos commonly ignore the whole `.zvec-grep/` dir
  (index artifacts) — and git cannot track files inside an ignored
  *directory*, so the config needs an explicit re-include to ship (`.zvec-grep/*`
  + `!.zvec-grep/config.json`). The committed file activates project scope
  for every machine that pulls it — the intended team-wide mechanism.
- All 6 suites green; committed locally. **Not released — no version bump,
  no tag, no publish** (explicit decision; bump to 0.4.0 when shipping).
- Deliberately diverges from pi-shepherd's delta model (same latent issues);
  mirror there later if parity is wanted.

### Previous unreleased intermediate state (kept for the record)

Between the decisions there were two intermediate local states, each
superseded within the same session (nothing was pushed):

1. "Self-contained file + `settingsScope` pointer in the USER file"
   (delta gone, but activation still a machine-global switch) — the
   never-pushed commit that started this section.
2. "Per-workspace activation with a STRING key"
   (`settingsScope: "project"` inside the project file; deactivation
   deleted the key) — commit `38f3311`, superseded by the boolean-refactor
   commit. If that exact state is ever needed, `git show 38f3311`.

## Publishing state (as of v0.3.0, 2026-09-03)

Live on npm (`latest` tag): **0.3.0** (12 files, provenance signed from
GitHub Actions). CI publish path is fully verified end-to-end:
`git push` → `git tag vX.Y.Z` → `git push origin <tag>` → `gh release create <tag>` →
the `publish.yml` release workflow builds from the tag, runs `npm test` + installs a
global `zg`, and runs `npm publish --access public --provenance` via **OIDC trusted
publishing**. No local `npm publish` is needed — that hits npm 2FA in non-interactive
shells and is deliberately avoided.

Release verification (registry, after the CI run completes):
`npm view @luminascale/pi-zvec-grep@<v> version dist.fileCount dist.integrity`.

Publishing history (2026-09-03):
1. v0.1.0 bootstrapped **manually** from an interactive terminal (OIDC not yet
   configured — trusted-publisher records only exist once the package exists). Tag +
   release then reran the workflow; run 1 failed at `npm test` (runners have no `zg`)
   → added `npm install -g @zvec/zvec-grep@0.2.1` step (global, not a dependency, by
   design). Run 2 used the *old* workflow def (release events resolve the workflow from
   the tagged commit) → moved the tag to the fix commit. Run 3: tests green, failed only
   at `npm publish` (no trusted publisher yet). Final run green via the already-published
   no-op guard.
2. **OIDC configured in the interim** (npmjs.com package page → trusted publishing: GitHub
   Actions, user `MikkelKappelPersson`, repo `pi-zvec-grep`, workflow `publish.yml`).
   Verified by v0.1.1 (9 files) shipping purely through CI with `npm notice publish
   Signed provenance statement ... Provenance statement published to transparency log`.
3. v0.2.0 (10 files) shipped the same way: tag → release → CI green with
   provenance. No manual publish used.
4. v0.2.1 (10 files, 2026-09-03): single /zg command with subcommand dispatch
   (rebuild/drop added to the slash surface; /zg-index + /zg-status dropped).
   Same tag → release → CI green path, clean run in 43s.
5. v0.3.0 (12 files, 2026-09-03): auto-index on session start (`autoIndex`
   setting, default off) — guarded by `zg status --check-ready` (real-zg exit
   semantics verified: 1 on no index and on stale), fire-and-forget build with
   per-root in-flight dedupe; `/zg settings` toggle; new `verify-autoindex`
   test suite + fake zg ready/stale-slow/fail-index modes. Tag `v0.3.0` →
   release → CI green → provenance-published. (Note: the settings feature
   landed in the same 0.3.0 — its "next release" line is closed by this.)

Remaining (optional for future releases):
1. Optional: add the repo to pi-mcp-adapter's known-servers.
2. Optional: pin the `zg` CLI version in `.github/workflows/publish.yml` (currently
   `@zvec/zvec-grep@0.2.1`) so a new zg major can't silently break the contract guard.

Note: the `npm publish` step will succeed in CI once OIDC is configured;
no workflow change needed. The already-published guard makes re-runs safe.

### Old TODOs (resolved above, kept for the record)

1. **npm scope ownership** — `@luminascale` must exist on npm owned by your account.
   If already published under your account, skip. For a brand-new package name, GitHub
   OIDC must be trusted on the npm side first (one-time setup); until then a manual
   `npm publish --access public` works, or publish directly once OIDC is configured.
2. **GitHub trusted publishing** — configure on the new repo after the first successful
   publish (Settings: npm package → Trusted publishing): GitHub user
   `MikkelKappelPersson`, repo `pi-zvec-grep`, default branch, workflow `publish.yml`;
   then protect: only release tags trigger publish. **Blocker found 2026-09-03:** the
   token in `~/.npmrc` is stale (401 on `/whoami`) — re-authenticate (browser
   flow) before any manual publish, or complete the OIDC dance via the npmjs.com UI
   (per-package trusted-publisher config is UI-only; `npm trust` needs interactive 2FA).
3. ~~Tag the release~~ DONE — tag `v0.1.0` on `394459e`, release published
   (workflow verifies tag == package version; a green release run = shipped).
4. Optional: add the repo to pi-mcp-adapter's known-servers / README "install from git"
   example is already in the README (`pi install git:github.com/MikkelKappelPersson/pi-zvec-grep`).

## Try it without publishing

```bash
pi install /home/mikkelkp/.pi/agent/extensions/pi-zvec-grep   # local path install
# or just run pi in this folder — package with pi.extensions manifest is auto-discovered
```

Then in any project: `/zg index` once, and `zvec_search` is available to the model.

## Known boundaries (deliberate, documented in README)

- Requires global `zg` (`npm i -g @zvec/zvec-grep`); not bundled as a dependency.
- One index per workspace root (`.zvec-grep/` under the root); re-run index after heavy edits.
- `zvec_index` `drop` auto-`--yes` — the tool surface has no interactive prompt; the
  tool description tells the model not to drop/rebuild unless explicitly asked.
- `verify-cli` fails without a real zg install (by design — it is the contract guard).

## Notes / gotchas discovered while building

- `zg` has no `--rg`-independent root flag for `zg query`: **cwd is the workspace root**.
  Every call pins `cwd` to the normalized root; that's the single most important wiring
  detail in `tools.ts`.
- `zg query` exits 0 with no managed-`rg` matches (unlike real rg exit 1); errors exit 1
  with a structured `Code:`/`hint:` block → surfaced verbatim to the model as the error.
- Managed `--rg` rejects `-c`, `-l`, `--json`, `--count-matches` etc. ("changes rg output")
  — hence the rg-split design rule.
- Extensions loaded via pi's jiti get `typebox`/`pi-tui`/`pi-coding-agent` aliased (see
  pi loader `getAliases()`); tests instead resolve via in-repo devDeps.
- `execute(toolCallId, params, signal, onUpdate, ctx)` — ctx (5th arg) carries `cwd`;
  commands get ctx as 2nd arg of the handler.
