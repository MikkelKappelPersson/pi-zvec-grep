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

| Command | What it does |
| --- | --- |
| `/zg-index [path]` | Build or update the zvec index for the current (or named) workspace. |
| `/zg-status [path]` | Show zvec index state for the current (or named) workspace. |

## Quickstart

```bash
# index a workspace once (local model auto-downloads, stays on disk)
/zg-index

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
  tools.ts               # the pi tool + command surface
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
```

> `verify-cli.mjs` shells out to the real `zg` and will FAIL if `@zvec/zvec-grep` is not installed — install it first, or rely on the hermetic suites for CI without it.

## Publishing

Releases publish to npm via GitHub **trusted publishing** (OIDC, no static npm token). Tag a release matching the `package.json` version (e.g. `v0.1.0`); the workflow verifies the tag, runs the test suite, and publishes with provenance. See `.github/workflows/publish.yml`.

## License

Apache-2.0. `pi-zvec-grep` is a thin integration layer over the separately-licensed `@zvec/zvec-grep` CLI and the zvec engine it ships.
