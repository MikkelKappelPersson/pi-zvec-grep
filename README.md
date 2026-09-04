# pi-zvec-grep

Extends [pi](https://github.com/earendil-works/pi) with [**zvec-grep**](https://github.com/zvec-ai/zvec-grep) (a.k.a. `zg`) as a native tool + commands — local-first hybrid search across your workspace for humans **and** agents.

- 🧠 **Semantic + exact in one call** — hybrid (BM25) + vector retrieval behind `zvec_search`
- 📍 **Ranked, source-linked hits** — file, line range, symbols, source
- 🏠 **Local-first** — index + embeddings on your machine; remote only with your explicit consent
- 🛠️ **Agent-native** — three tools + two commands, no MCP server required

## Install

Requires Node 22+ and the CLI globally:

```bash
npm i -g @zvec/zvec-grep
```

Then install this package into pi:

```bash
pi install npm:@luminascale/pi-zvec-grep
```

Or from git:

```bash
pi install git:github.com/MikkelKappelPersson/pi-zvec-grep
```

Restart pi or run `/reload`.

## Tools

| Tool | What it does |
| --- | --- |
| `zvec_search` | Hybrid semantic + keyword search over an indexed workspace. Query groups (`query`, `queries`, `fts`, `vector`), `fuse`, globs, file types, symbol focus, modified-after filters, and a `root` (defaults to cwd). |
| `zvec_index` | Create, update, **rebuild**, or **drop** a workspace index. Prefers a local embedding model. |
| `zvec_status` | Show index presence, coverage, freshness, and the suggested next action. Missing index is a normal state. |

## Commands

One slash command, `/zg`, dispatches on a subcommand. All take an optional `[path]` (workspace root; defaults to the current directory). Bare `/zg` or `/zg help` prints usage.

| Command | What it does |
| --- | --- |
| `/zg index [path]` | Create or incrementally update the workspace index. |
| `/zg rebuild [path]` | Recreate the index from scratch. |
| `/zg drop [path]` | **Permanently delete the workspace index** (runs with `--yes`; no prompt). |
| `/zg status [path]` | Show index presence, coverage, freshness, and the suggested next action. |
| `/zg settings` | Open the settings menu (interactive TUI): settings scope, default search limit, auto index on start. |
| `/zg help` | Print usage. |

## Settings

`/zg settings` opens a scoped settings menu. Two config layers:

| Layer | File | Contents |
| --- | --- | --- |
| User (default) | `~/.pi/agent/pi-zvec-grep/config.json` | Values only — the base defaults for every workspace that has NOT activated project scope. Scope flags never apply from this file: a `projectScope` key here is ignored, and a legacy `settingsScope` key is ignored and stripped on the next save. |
| Project | `<workspace>/.zvec-grep/config.json` (anchored at cwd, no walk-up) | **Self-contained** — the whole project config as the full values object, plus the boolean activation flag `projectScope`. `true`: this file alone is authoritative **for this workspace only** (values = built-in defaults + its contents, no user values mixed in), so the committed file means the same on every machine — and activating it can never flip any other project. `false` (or absent in a hand-written file): the values are stored but dormant and the user layer applies. Files the menu manages always carry the flag, so a committed file declares its state explicitly. Fields missing from the file fall back to the built-in defaults. (A legacy `settingsScope: "project"` string in an old file is still read as `true`; never written.) |

- **Settings scope** (`user` \| `project`): where the menu reads its values from and writes its edits to — per workspace, never machine-wide. Activation is the boolean `projectScope` flag inside the project file: a repo can only ever change the settings of its own workspace. Picking `project` saves the project file (creating it if missing, `Config created at …` on first creation) with `projectScope: true` plus the values — a dormant file's parked values win over your user values, so activating a team file never overwrites it. Picking `user` sets `projectScope: false` — stored values stay dormant, the file is never deleted, and this workspace's user values apply again.
- **Default search limit** (1–50): the `--limit` used by `zvec_search` when the tool call passes no explicit `limit`. An explicit tool-call limit always wins.
- **Auto index on start** (off by default): on every `session_start`, the hook runs `zg status --check-ready` in the working directory and, when the index is missing or stale, builds/updates it in the background (fire-and-forget; never blocks startup or the lifecycle hook). Healthy indices cost one fast guard call per start; only a missing/stale index triggers a build. Enabled in the user file for all workspaces, or in the project file for one workspace. The first build can take a while and may download the local embedding model — hence off by default.

Config files are read fresh on every use (mtime-cached), so hand edits take effect immediately.

**Committing project settings to a repo.** The file is self-contained, so sharing it via the repo is the intended way to make settings team-wide. Note that `.gitignore` commonly ignores the whole `.zvec-grep/` directory (it holds runtime index artifacts) — and git cannot track files inside an ignored *directory*, so a bare `.zvec-grep/` entry keeps the config out of the repo too. Re-include just the config with:

```gitignore
.zvec-grep/*
!.zvec-grep/config.json
```

```jsonc
// user: ~/.pi/agent/pi-zvec-grep/config.json (values only — no scope flag)
{
	"defaultLimit": 7,
	"autoIndex": false
}

// project: .zvec-grep/config.json (self-contained — values + boolean flag)
{
	"defaultLimit": 25,
	"autoIndex": true,
	"projectScope": true
}
```

## Quickstart

```bash
# index a workspace once (local model auto-downloads, stays on disk)
/zg index

# then just ask the agent — it picks zvec_search on its own
```

Or, from the CLI directly:

```bash
zg index /path/to/workspace --embedding local/potion-code-16m-v2
zg query "how is the token validated"
```

## Design: what it is (and is not)

`zvec-grep` unifies ripgrep, BM25, and vector search behind one interface. But its own guidance is explicit: **keep native `rg` for exact text**. So this package is *not* a drop-in grep replacement — it's a first-class **search** layer for the cases `rg` can't reach:

- meaning / fuzzy / concept-based discovery
- cross-file, call-chain, data-flow, and architectural synthesis
- design-rationale questions where you don't already know the exact identifier

`rg` stays the workhorse for exact strings, regex, counts (`-c`), file lists (`-l`), and anything you pipe. (Managed `zg query --rg` deliberately rejects output-format flags like `-l`/`-c`/`--json` and normalises its output/exit-codes — that's the boundary.)

The routing rule is baked into the tool descriptions and the `promptGuidelines` so the model chooses the right tool without extra prompting.

## Layout

```text
index.ts                 # entry — registers tools + commands
src/core/
  queries.ts             # buildQueryArgs — zvec_search argv contract
  indexing.ts            # buildIndexArgs — zvec_index argv contract
  workspace.ts           # normalizeRoot + clip
  zg.ts                  # pi.exec wrapper around the global `zg`
src/extension/
  tools.ts               # the pi tool + command surface + auto-index session hook
  config.ts              # two-layer settings: values-only user file + self-contained project file with the boolean activation flag
  settings-ui.ts         # /zg settings menu (SettingsList)
test/
  verify-*.mjs           # plain node --experimental-strip-types harness
  helpers/
    test-utils.mjs       # temp dirs, PASS/FAIL reporter
    fake-zg.mjs          # deterministic fake `zg` on PATH
    pi-harness.mjs       # fake ExtensionAPI with a real child_process exec
```

## Testing

No test framework — Node's type stripping + a fake `zg` binary (no real `zg`/index/network needed). Tests run hermetically via a fake `pi` whose `pi.exec` is a real `child_process.execFile` bound to a PATH with the fake `zg` prepended.

```bash
npm test
# or individually:
npm run cli:test        # real `zg` contract (needs zg installed)
npm run surface:test    # tool surface + execute wiring (fake)
npm run queries:test    # buildQueryArgs (pure)
npm run indexing:test   # buildIndexArgs (pure)
npm run errors:test     # normalizeRoot/clip/error shaping (pure)
npm run settings:test   # config layers: per-workspace flag, dormant/legacy files, full writes (pure + tool wiring)
npm run autoindex:test  # session-start auto-index hook: guard, fire-and-forget, in-flight (fake)
```

> `verify-cli.mjs` shells out to the real `zg` and will FAIL if `@zvec/zvec-grep` is not installed — install it first, or rely on the hermetic suites for CI without it.

## Publishing

Releases publish to npm via GitHub **trusted publishing** (OIDC, no static npm token). Tag a release matching the `package.json` version (e.g. `v0.1.0`); the workflow verifies the tag, runs the test suite, and publishes with provenance. See `.github/workflows/publish.yml`.

## License

Apache-2.0. `pi-zvec-grep` is a thin integration layer over the separately-licensed `@zvec/zvec-grep` CLI and the zvec engine it ships.
