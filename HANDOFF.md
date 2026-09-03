# Handoff — pi-zvec-grep

Repo: `/home/mikkelkp/.pi/agent/extensions/pi-zvec-grep` → remote `https://github.com/MikkelKappelPersson/pi-zvec-grep.git`
npm target: `@luminascale/pi-zvec-grep` (v0.1.0)

## What this is

A pi extension (package format, same layout as sibling `pi-shepherd`) that exposes the
global `zg` CLI ([zvec-grep](https://github.com/zvec-ai/zvec-grep)) as three native pi
tools plus two slash commands. No MCP server involved — everything shells out to `zg`
via `pi.exec`.

Surfaces:
- `zvec_search` — hybrid semantic+keyword search over an indexed workspace (query groups,
  fuse, globs, file types, symbol focus, mtime filters, optional `root`)
- `zvec_index` — index / rebuild / drop a workspace (local embedding models recommended)
- `zvec_status` — index presence/coverage/freshness; missing index is a normal state
- `/zg-index [path]` — build/update index for cwd (or named path)
- `/zg-status [path]` — show index state

Design rule baked into tool descriptions: `zvec_search` = meaning/fuzzy/unknown-location
questions; plain `rg` stays for exact strings, counts, file lists, pipes (zg's managed
`--rg` intentionally can't do those).

## State: DONE and VERIFIED

- Layout mirrors pi-shepherd: `index.ts` entry → `src/core/` (pure argv/normalization helpers)
  → `src/extension/tools.ts` (pi surface). No runtime imports in `src/core/`.
- `npm test` — all 5 suites green:
  - `verify-cli.mjs` — real `zg` 0.2.1 contract (query/index flags, managed `--rg` accepted
    flags, rejected output-format flags `-c/-l/--json`, no-index error code)
  - `verify-surface.mjs` — real `index.ts` against fake pi + fake `zg` on PATH: registration,
    schemas, argv/cwd/signal wiring, drop→`--yes`, error path, timeouts
  - `verify-queries.mjs` / `verify-indexing.mjs` — pure argv-builder contracts
  - `verify-errors.mjs` — normalizeRoot (cwd fallback, `@`-strip) + clip + error shaping
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

## What's LEFT (publishing only)

1. **npm scope ownership** — `@luminascale` must exist on npm owned by your account.
   If already published under your account, skip. For a brand-new package name, GitHub
   OIDC must be trusted on the npm side first (one-time setup); until then a manual
   `npm publish --access public` works, or publish directly once OIDC is configured.
2. **GitHub trusted publishing** — configure on the new repo
   (Settings → Deploy tokens / npm trusted publishing), repo name must match what npm has;
   then protect: only release tags trigger publish.
3. **Tag the release** — `git tag v0.1.0 && git push origin v0.1.0` and create the
   release on GitHub (workflow verifies tag == package version).
4. Optional: add the repo to pi-mcp-adapter's known-servers / README "install from git"
   example is already in the README (`pi install git:github.com/MikkelKappelPersson/pi-zvec-grep`).

## Try it without publishing

```bash
pi install /home/mikkelkp/.pi/agent/extensions/pi-zvec-grep   # local path install
# or just run pi in this folder — package with pi.extensions manifest is auto-discovered
```

Then in any project: `/zg-index` once, and `zvec_search` is available to the model.

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
