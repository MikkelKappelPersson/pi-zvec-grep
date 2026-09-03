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

## TUI rendering (post-v0.1.0, uncommitted-at-release-time)

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
  - `keyHint('app.tools.expand')` is the expand hint (deferred call — module import must not touch
    pi's theme, which breaks the hermetic node test loader).
  - Structured data rides in `details` (`summary` / `verdict`) so session state survives re-renders
    and branching; renderers also re-parse `content` text as fallback for old sessions.
- Remaining (known good next steps): zvec_index live elapsed timer (bash-renderer
  startedAt/interval/invalidate pattern), path shortening in call lines (built-in
  `~/…` convention), parse `zg index` output for a one-line finish summary.

## What's LEFT (publishing only) — DONE 2026-09-03

Published: `@luminascale/pi-zvec-grep@0.1.0` on npm (`latest` tag, 20 files,
~22.7kB tarball, shasum `e2e655f1…af224d56` — verified against the registry).
Tag `v0.1.0` points at `9fa9a3c` (code = `394459e`; diff is CI fix + this
handoff), and the release-run pipeline is verified green end-to-end.

Publishing history (2026-09-03):
1. Tag + release fired the workflow; run 1 failed at `npm test` — CI runners
   have no `zg`. Fixed: `npm install -g @zvec/zvec-grep@0.2.1` step in
   `.github/workflows/publish.yml` (deliberately global, not a dependency:
   the extension requires a pre-existing global `zg`). Run 2 still used the
   *old* workflow def (release events resolve the workflow from the tagged
   commit) → had to move the tag to the fix commit. Run 3: tests green,
   tarball clean, failed only at `npm publish` (no trusted publisher yet).
2. v0.1.0 bootstrapped **manually** from a local terminal
   (`npm publish --access public`, account + 2FA one-time auth in the
   interactive `npm` CLI — note npm mangles auth URLs in non-interactive
   shells, so an interactive terminal is required). Per the npm docs,
   trusted-publisher records live on the package page, which requires the
   package to exist first — that's why the workflow was written with the
   already-published guard.
3. Release re-published after the manual publish → workflow finished green
   via the already-published no-op guard (full CI path verified).

Remaining (optional, for future releases):
1. **npm trusted publishing (OIDC)** — UI-only on the npmjs.com package
   page → access: add trusted publisher GitHub Actions, user
   `MikkelKappelPersson`, repo `pi-zvec-grep`, default branch, workflow
   `publish.yml`. Until then: bootstrap each version manually from a local
   terminal (interactive), then push tag + release for the green run.
   (`npm trust` also exists but needs interactive 2FA.)
2. Optional: add the repo to pi-mcp-adapter's known-servers.
3. Optional cosmetic: add `files: ["index.ts", "src"]` to package.json at the
   next real version to drop the dev-only `test/` files from the tarball.
   (Chose NOT to add `.npmignore`: it would replace the working `.gitignore`
   fallback with a duplicate rule list; parity with pi-shepherd is
   intentional — its `npm warn gitignore-fallback` line is likewise benign.)

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
