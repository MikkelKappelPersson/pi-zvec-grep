#!/usr/bin/env node
/**
 * Formatter harness: parseSearchOutput / parseStatusVerdict / hitHeadline.
 *
 * Fixtures are real captured `zg query` / `zg status` outputs (zg 0.2.1).
 * Contract: parsers are forgiving — unrecognized input yields undefined, never throws.
 */
import { parseSearchOutput, parseStatusVerdict, hitHeadline } from '../src/core/format.ts';
import { createReporter } from './helpers/test-utils.mjs';

const { assert: check, done } = createReporter();

const SINGLE_GROUP = `query groups (1):
Q1 [primary]: gitignore
hits: 7

#1 matchedBy=fts+vector HANDOFF.md:25-48
status: possibly_stale
heading: State: DONE and VERIFIED
heading_level: 2
scope: Handoff — pi-zvec-grep
25	## State: DONE and VERIFIED

#2 matchedBy=vector test/verify-cli.mjs:45
45	runRg = (...args) => spawnSync('zg', ['query', '--rg', ...args], { cwd: ws, encoding: 'utf8' })
`;

const TWO_GROUPS = `query groups (2):
Q1 [primary]: what happens when there is no index
hits: 3

#1 matchedBy=fts+vector test/verify-indexing.mjs:1-44
1	#!/usr/bin/env node

#2 matchedBy=fts+vector src/extension/tools.ts:64-162
status: possibly_stale
symbol: function registerZvecTools
98	pi.registerTool({

#3 matchedBy=fts+vector HANDOFF.md:72-79
heading: Known boundaries (deliberate, documented in README)
72	## Known boundaries (deliberate, documented in README)

Q2 [supplemental]: gitignore
hits: 1

#1 matchedBy=fts HANDOFF.md:25-48
status: possibly_stale
heading: State: DONE and VERIFIED
25	## State: DONE and VERIFIED
status: possibly_stale
results: served_from_current_index
`;

const ZERO_HITS = `query groups (1):
Q1 [primary]: zzz qqq
hits: 0
`;

// --- parseSearchOutput: single group
const s1 = parseSearchOutput(SINGLE_GROUP);
check(s1 !== undefined, 'single group parses');
check(s1.totalHits === 7, 'total hits sums group hit counts');
check(s1.fileCount === 2, 'distinct files counted');
check(s1.hasStale === true, 'stale flag set from status lines');
check(s1.groups.length === 1 && s1.groups[0].label === 'Q1' && s1.groups[0].role === 'primary', 'group label + role');
check(s1.top?.rank === 1 && s1.top?.matchedBy === 'fts+vector', 'top hit rank + matchedBy');
check(s1.top?.file === 'HANDOFF.md:25-48', 'top hit file ref keeps line range');
check(s1.top?.kind === 'heading' && s1.top?.label === 'State: DONE and VERIFIED', 'heading metadata captured');
check(s1.top?.preview === '## State: DONE and VERIFIED', 'preview stripped of leading line number');
check(s1.top?.status === 'possibly_stale', 'status captured on hit');

// --- multi group
const s2 = parseSearchOutput(TWO_GROUPS);
check(s2 !== undefined, 'multi group parses');
check(s2.totalHits === 4, 'total spans groups (3+1)');
check(s2.fileCount === 3, 'distinct files across groups (tools.ts, verify-indexing.mjs, HANDOFF.md)');
check(s2.groups.length === 2 && s2.groups[1].role === 'supplemental', 'group roles parsed');
check(s2.top?.file === 'test/verify-indexing.mjs:1-44', 'top is first hit of first group');
check(s2.top?.kind === 'text' && s2.top?.preview === '#!/usr/bin/env node', 'text hit: preview kept, no label');

// --- zero hits
const s3 = parseSearchOutput(ZERO_HITS);
check(s3 !== undefined && s3.totalHits === 0 && s3.top === undefined, 'zero-hit output: total 0, no top');

// --- unrecognized input degrades
check(parseSearchOutput('') === undefined, 'empty input → undefined');
check(parseSearchOutput('totally different shape\nno groups at all') === undefined, 'unrecognized shape → undefined');
check(parseSearchOutput('Error: No zvec-grep index found\nCode: X\n') === undefined, 'zg error block → undefined (renderer takes error path)');

// --- hitHeadline
const noTop = { rank: 1, file: 'a.ts:1' };
check(hitHeadline(noTop) === 'a.ts:1', 'headline with file only');
check(hitHeadline({ ...noTop, label: 'My Heading' }) === 'a.ts:1 — My Heading', 'headline prefers label over preview');
check(hitHeadline({ ...noTop, preview: 'x'.repeat(80) }).endsWith('…'), 'long preview clipped with ellipsis');
check(hitHeadline({ rank: 1, preview: 'only preview' }) === 'only preview', 'headline without file uses preview');

// --- parseStatusVerdict
const READY = `✓ Workspace index is ready
  /tmp/ws

  Coverage    ████████████████████ 100%  1 / 1 files
  Entities    1
  Truncated   0 fragments
  Queue       0 pending · 0 failed

  Embedding   local/potion-code-16m-v2
              256 dimensions · cosine

  Storage     .zvec-grep/index.zvec`;

const STALE = `! Workspace index needs an update
  /home/u/ws

  Coverage    █████████████████░░░  83%  15 / 18 files
  Entities    62
  Truncated   0 fragments
  Queue       0 pending · 0 failed
  Changes     1 added · 3 modified · 2 deleted

  Embedding   local/potion-code-16m-v2
              256 dimensions · cosine

  Storage     .zvec-grep/index.zvec

  Next        zg index`;

const MISSING = `? Workspace index is not configured
  /tmp/ws

  Storage     .zvec-grep/index.zvec
  Policy      undecided

  Next        zg index or zg query --rg`;

const r = parseStatusVerdict(READY);
check(r?.kind === 'ready' && r.line === 'index ready', 'ready verdict, clean');

const rDirty = parseStatusVerdict(READY + '\n  Changes     0 added · 3 modified · 0 deleted');
check(rDirty?.kind === 'ready' && /3/.test(rDirty.line), 'ready with pending changes notes the delta');

const st = parseStatusVerdict(STALE);
check(st?.kind === 'needs-update' && st.line.includes('1 added') && st.line.includes('3 modified') && st.line.includes('2 deleted'), 'stale verdict carries change counts');
check(st.line.includes('zvec_index'), 'stale verdict suggests zvec_index');

const miss = parseStatusVerdict(MISSING);
check(miss?.kind === 'missing' && miss.line === 'no index — run zvec_index', 'missing verdict');

const noErr = parseStatusVerdict('Error: No zvec-grep index found for this workspace\nCode: WORKSPACE_INDEX_NOT_FOUND');
check(noErr?.kind === 'missing', 'zg no-index error block counts as missing');

check(parseStatusVerdict('brand new unknown format') === undefined, 'unknown status format → undefined (raw fallback)');
check(parseStatusVerdict('(no output)') === undefined, 'no-output text → undefined');

done();
