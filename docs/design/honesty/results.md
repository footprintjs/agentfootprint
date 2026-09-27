# Layer 3 · Read a result — the three result doors, the period, and how the record reads them

**Design, 2026-09-26. Adopted overnight 2026-09-27 on the owner's go; the owner may overturn.
Nothing here is built unless a line says "shipped" or "drafted".**

> **Status, 2026-09-27.** Every question in § 10 took its recommended answer;
> [decisions.md](decisions.md) records them (Q33–Q43, and this page's Q12 is decisions.md Q13). The
> text below is the page as reviewed on 2026-09-26, with its file names and links updated for this
> folder. Step 7a (`describedResult()`, § 6) was delivered on its own track: it merged to main as
> #22 (`0600ab53`) late on 2026-09-26, after this page was written.

- Written against agentfootprint 9.118.1 (`8360b3b8` on npm; its fix `f83f277c` shipped the
  request's fix 0 and fix 1) and footprintjs 9.27.0.
- The layer page for [the architecture note](README.md) (revision 2) § 3.3. Where the two differ,
  this page says which shape wins and why. It carries items 6 and 7 of the owner's framing
  ([decisions.md](decisions.md), "The owner's framing") and the request
  `agentfootprint-video-course:docs/library-requests/2026-09-26-typed-result.md` ("the request").
- Code is cited as `file · symbol`. Paths are under agentfootprint's `src/`; `coverage/`,
  `findings/`, `stages/` mean `src/core/agent/<folder>/`. `host:` is the host app that field-tests
  the library; `study:` is the honest-answers study.
- **A draft of step 7a is now COMMITTED on a local branch** — `feat/described-result`, one commit
  `d8258fd3` (54 files, 2026-09-26 23:07), not pushed, no PR, not released; `main` is still at
  9.118.1 (`8360b3b8`). It was uncommitted when this page was first written. It holds:
  `lib/semantics/described.ts` · `describedResult`, the one core `lib/semantics/envelope.ts` ·
  `mintSemantics` with its `DeclarationDoor`, `lib/semantics/types.ts` ·
  `DescribedResultDeclaration`, the gate advice in `lib/semantics/check.ts`, a decision table in
  `docs-next/content/docs/build/tools.mdx`, example 66, and two tests. It is not on main, not
  released, and not made by this design pass. § 6 reviews it against the request. Everything else
  on this page cites code on main (9.118.1).

---

## For the owner

1. A tool's result has three doors, and each says what the result covered: `absent()` (nothing matched, and where it looked), `coverage()` (any other value that has limits), `describedResult()` (rows from a system of record, with source, time, grain and limits). The wire does not change.
2. `describedResult()` is `semantic()` renamed: camelCase in, the same snake_case wire out; `semantic()` stays, deprecated in TSDoc only; a missing source becomes a compile error. It can ship alone (step 7a), and a full draft is already committed on a local branch (`feat/described-result`, not pushed, no PR).
3. One period shape — the queried period, the held period or `'unknown'` said out loud, and when the read ran — rides all three doors and joins the inputs layer's period argument by call id. The library compares instants the tool declared and never parses "2h".
4. `absent()` gains a source and a time (`provenance`, the shape `describedResult()` already has) and the period, so "searched the 02:00 export — nothing" becomes data instead of prose.
5. The served view has one rule: each door serves the ground its value cannot show for itself, and the record keeps everything. So `absent()` and `coverage()` serve `checked` and `describedResult()` does not — today's asymmetry, kept on purpose and put to a bench.
6. The standing reads every result through ONE emptiness reader, shared with the `/observe` answer account. An envelope stops reading as "returned a result", and a bare empty result reads as `empty-undeclared`: silence is recorded as silence.
7. The period verdict (covered · partly held · not held · unknown · undeclared) is one pure rule, filed as a ledger row by the results layer. A nightly export asked about "the last hour" then reads "not sure — the data ends at 02:00", with no phrase parsing anywhere.
8. Nothing becomes a default until its bench shows a gain. The rename needs only golden tests (the wire is identical); the period, a served `checked` list and a shorter note each get a bench cell.
9. What it lets you measure, from the record alone: the door mix and declaration rate per tool, the share of results the record cannot read, the period verdict mix, and answers that claim more than their period covered.
10. Twelve questions wait for you (§ 10). The three that shape the rest: whether `held: 'unknown'` on a non-empty result makes the answer "not sure", whether `coverage()` also gets `provenance`, and whether the shorter note ships.

---

## 1. The three doors

### 1.1 The decision table

| Door | Use it when | What the model reads | What the record keeps | Status delivered |
|---|---|---|---|---|
| `absent({ what, checked, … })` | the search ran and nothing matched | the whole envelope minus the record-only item keys `short` and `kind`: `af_absent`, `outcome: "nothing_found"`, `looked_for`, `checked`, `not_checked`, `cannot_cover`, `retry_returns_the_same`, `try_instead`, `try_instead_tool`, and `ABSENCE_NOTE` (385 characters) | the `agentfootprint.tools.absent` event (with `lookedFor`, the lists with `short`/`kind`, `tryInstead`, `tryInsteadTool`); one tracked `coverageDeclared` row of kind `'absence'`, which does not carry the suggestions | `'absent'` |
| `coverage(value, { … })` | any other value that has limits: a verdict, a sentence, an object you will not reshape | `af_coverage` (the lists minus `short`/`kind`, and `COVERAGE_NOTE`, 318 characters), serialized BEFORE `result`, so the agent's truncation keeps the limits; then `result`, untouched | `agentfootprint.tools.coverage_declared`; one `coverageDeclared` row of kind `'ledger'` (plus the absence's own row when it wraps one) | none, or `'absent'` around an absence |
| `describedResult({ … })` | rows, a series or relationships from a system of record — or a question handed back (`clarify`) | the projection `lib/semantics/envelope.ts` · `semanticsForModel`: the data, `grain`, `provenance`, the composed `not_covered` lines, a non-null `clarify`, and `SEMANTICS_NOTE` (329 characters) — never the marker, `render`, or the three coverage lists, so never `checked` | the FULL envelope on `agentfootprint.tools.semantics_declared`, filed before the result ceiling is measured, so it survives a refused oversized result; its `coverage` as a `coverageDeclared` row of kind `'ledger'`; flattened claim rows on `claimFacts` under `.claims()` | none |
| no door | a value with no limits worth stating | the value as returned | `stream.tool_end` only; no coverage row | none |

**The rule** (the request's, kept): rows from a system of record → `describedResult()`; any other
value that has limits → `coverage()`; nothing matched → `absent()`. Never wrap one in another:
`describedResult()` carries its own `coverage`. The one composition the code recognizes on purpose
is `coverage(absent(…))`, a search that found nothing inside a boundary — both rows are filed and
the status stays `'absent'` (`coverage/read.ts` · `readCoverageResult`).

### 1.2 Laws the three doors already share (checked in code, 2026-09-26)

- **Minted by a helper, recognized by the framework.** The mint refuses a declaration it cannot
  honor at the call site. Since 9.118.1 every refusal starts `refused: ` (`coverage/refusal.ts` ·
  `refusal`), and an unknown or snake_case declaration key is refused, naming the camelCase one
  (`coverage/refusal.ts` · `refuseUnknownKeys`). Inside `execute`, the refusal becomes the call's
  error result: the model reads it in place of the data, and the run continues.
- **One recognizer, at every execute boundary.** `stages/toolCalls.ts` · `declareCoverage`, then
  `declareSemantics`, at the batch loop and in `resolveCredentialAndExecute` (the resume doors) —
  before the ceiling, the column judge, the after-tool chain, placement and the cap.
- **Record-only keys never reach the request.** `coverage/read.ts` · `servedToModel` strips
  `short` and `kind` from every recognized envelope object.
- **Tool knowledge grounds; the caller's echo does not.** `coverage/evidence.ts` withholds
  `looked_for`, `short` and `kind` from the evidence corpus. Everything else a door carries is the
  tool speaking about the world, and grounds.
- **Recognition strictness differs per door — and it decides what a new wire field costs** (§ 3.6):
  - `coverage/recognize.ts` · `readAbsence` asks only for `af_absent: true` and a non-empty
    `checked`; any other key rides through as tool knowledge.
  - `coverage/ledger.ts` · `readCoverageLedger` asks only for an `af_coverage` object and a
    `result` key.
  - `lib/semantics/envelope.ts` · `readSemantics` refuses ANY key its vocabulary lacks
    (`semanticIssues`: "which is not a field this vocabulary has"). A marker-bearing value with a
    fault stays plain data, dev-warned — "this library does not half-apply a shape it cannot fully
    honor".
- **Data arrays are never empty.** `series`, `facts` and `edges` must be non-empty
  (`semanticIssues`), so "nothing matched" has exactly one door: `absent()`.

### 1.3 One small fix the table asks for

The empty-data refusal reads "`facts` must be a non-empty array of rows — omit the field to say
nothing" (`semanticIssues`). Two things are wrong with it:

- Following it leads straight to the next refusal ("this result declares nothing").
- It is data-dependent: a tool without an empty branch passes every test that has rows and refuses
  on its first empty read in production, where the model reads the refusal instead of "nothing
  matched".

Change the message (one core, so both doors) to name the door: *refused: `facts` is empty — if
nothing matched, return absent({ what, checked }) instead.* The wire is untouched. The model reads
the refusal, so it is registered like every served sentence ([README.md](README.md) § 2.2, law 7). The
check:semantics gate can say the same when a catalog sample exercises an empty branch. The docs and SKILL.md
teach the branch the request asks for: `rows.length ? describedResult({ … }) : absent({ … })`.

---

## 2. `describedResult()` — the API

**The owner decided the name** (the owner's framing, item 6, in [decisions.md](decisions.md)): `describedResult()`, not the request's
`typedResult()`, because "typed" collides with `runTyped()`. The name says what the helper
returns — a result that carries its own description (source, time, grain, coverage) — and it is
the tool's RESPONSE: nothing is added to the system prompt or to the tool's schema.

### 2.1 One spelling per door

The declaration is camelCase throughout and is respelled to the unchanged snake_case wire. Data
rows keep the author's own keys.

| Declared (`describedResult()`) | On the wire (`af_semantics`, unchanged) |
|---|---|
| `grain.isCounter` | `grain.is_counter` |
| `provenance.measuredAt` · `ageSeconds` · `sourceExportDate` | `provenance.measured_at` · `age_seconds` · `source_export_date` |
| `render.filterNote` · `chartHint` | `render.filter_note` · `chart_hint` |
| `coverage.checked` · `notChecked` · `cannotCover` | `coverage.checked` · `not_checked` · `cannot_cover` |
| `series` · `facts` · `edges` · `clarify` · `render.default/columns/sort` | the same names |
| (never declared) | `not_covered` (composed from `coverage`) and `note` (the static sentence) |

- `describedResult()` refuses the snake_case spelling, and `semantic()` keeps its declaration byte
  for byte. Neither door takes both spellings in one object, so a migration that swaps only the
  function name fails loudly at the line that needs the new spelling.
- No `measuredAt` alias inside `semantic()`.
- **The input types are separate from the wire types.** `SemanticProvenance` is both the
  declaration and `ToolSemantics.provenance` today; a camelCase input on it would make the wire type
  claim a field the wire never carries. The camelCase shapes are internal and not exported by name
  (each export adds a generated API page against the site budget); an author reaches one as
  `DescribedResultDeclaration['provenance']`.
- **A missing source is a compile error.** `provenance` is required whenever `facts` or `series`
  is present (a conditional type, pinned by a `@ts-expect-error` test). A declaration with only
  `edges` or only a `clarify` question needs none. The run-time refusal stays for plain JavaScript
  and JSON-fed declarations.

### 2.2 Example — one `execute`, both branches

```ts
import { absent, defineTool, describedResult } from 'agentfootprint';

const backupRuns = defineTool({
  name: 'backup_runs',
  description: 'Backup runs for one host, read from the nightly backup export.',
  inputSchema: {
    type: 'object',
    required: ['host'],
    properties: { host: { type: 'string' } },
  },
  execute: async ({ host }) => {
    const snap = await loadExport(); // { exportedAt, rows } — the export's own time
    const rows = snap.rows.filter((r) => r.host === host);
    const limits = {
      checked: [`every backup job in the export of ${snap.exportedAt}`], // a value we resolved
      cannotCover: [{ what: 'jobs on the second backup product', why: 'not collected on this install' }],
    };
    if (rows.length === 0) {
      return absent({ what: `backup runs for ${host}`, ...limits }); // `what` quotes the request: never evidence
    }
    return describedResult({
      facts: rows.map((r) => ({ entity: r.host, day: r.day, ok: r.ok })),
      provenance: { measuredAt: snap.exportedAt, source: 'backup API export' }, // from the data, never typed in
      coverage: limits,
    });
  },
});
```

What the model reads on the found branch (the projection; the draft's docs capture the same shape
from example 66's run):

```json
{
  "facts": [{ "entity": "host-103", "day": "2026-08-19", "ok": true }],
  "provenance": { "measured_at": "2026-08-19T10:12:00Z", "source": "backup API export" },
  "not_covered": ["jobs on the second backup product — not collected on this install"],
  "note": "Typed data, not prose. `grain` and `provenance` are caveats that travel with the numbers: …"
}
```

- **Values come from the data.** `measuredAt` is the export's time for a file, the moment of the
  read for a live query, the newest sample for a series, and the END of the window for a value
  computed over one. It is never parsed ("last year, roughly" passes).
- **`clarify` does not pause the run.** It hands the model a question and its candidates; the model
  decides what to do. A pause is `requestInput`.
- **Same wire, so nothing downstream can tell the doors apart.** The same recognizer, event,
  projection, coverage absorption and `check:semantics` gate serve both. That is the golden test's
  point (§ 6).

### 2.3 What the page keeps from the request, and what it adds

- Kept: the name decision, the house law (camelCase declaration → unchanged snake_case wire;
  `semantic()` `@deprecated` in TSDoc only, in a 9.x minor; provenance required at compile time;
  input type split from the wire type; keep the wire, `SEMANTICS_NOTE`, `canonical-notes.json`, the
  recognizers, the `checkSemantics` name and the 17 `Semantic*`/`Semantics*` types).
- Added by this page, each its own step: the empty-data refusal naming `absent()` (§ 1.3);
  `provenance` and `period` on `absent()` and `period` on all three doors (§ 3); one emptiness reader
  (§ 5); a composed note (§ 4.3, owner's call).

---

## 3. Time coverage — the one period shape

**Law: a result says what time its read covered; silence about a declared period is recorded as
silence.** The motivating case: a tool queries the last 2 hours (a default nobody chose), the store
holds 30 days, the result is empty, and the answer says "no errors". Today the record holds no typed
window. If the author wrote one, it is prose in `checked` — the coverage README's own example
interpolates the model's argument into it (`` `collected latency samples over the last ${window}` ``).

### 3.1 The shape — shared with the inputs layer

```ts
// Declared, camelCase, on absent() / coverage() / describedResult():
interface DeclaredPeriod {
  /** ISO 8601 instants WITH a zone, of the READ that produced this result — not of "this call". */
  readonly queried: { readonly from: string; readonly to: string };
  /** What the store holds at the time of the read, or 'unknown', said out loud. */
  readonly held: { readonly from: string; readonly to: string } | 'unknown';
  /** When the read ran. A cached answer is served minutes after the read it describes. */
  readonly readAt?: string;
}
// Wire, snake_case:  "period": { "queried": { "from", "to" }, "held": { "from", "to" } | "unknown", "read_at"? }

// On the TOOL — owned by the inputs layer (arguments/), which refuses it at definition;
// the results layer only reads it:
interface ToolPeriod {
  readonly argument: string; // the argument that sets the period
  readonly spelling?: 'lookback' | 'signed-lookback' | 'iso-range';
}
```

- **Anchored on the read.** The host already does this in app code: its time-series tools return
  `data_window: { window: "-26h", range_end }`, where `range_end` is the newest sample the answer
  covers (`host:py-tools/server.py` · `_range_end`). That is the field precedent for `queried` and
  `readAt`. It has no `held`: the host never says what the store holds, which is exactly the gap.
- **Why not the word `window`:** it names the context window (`core/agent/window/`, `.window()`).
  **Why not `CoverageItem.kind: 'window'`** (the candidate the coverage README names): a kind is a
  closed, record-only word; it cannot hold instants to compare.
- **Why a zone is required:** an instant without one is ambiguous, and the library compares
  instants, so it refuses one at mint instead of guessing.

### 3.2 Three times, three jobs

| Field | Read by | Compared? | Means |
|---|---|---|---|
| `provenance.measuredAt` (`describedResult()`, and `absent()` from 7b) | the model | never parsed | how old the data is, in the tool's own words |
| `period.queried` | the library, and the model | yes, as instants | what the read asked for |
| `period.held` | the library, and the model | yes, as instants | what the store holds; `'unknown'` said out loud |
| `period.readAt` | the library | yes | when the read ran |

When the tool knows the instants, it declares the period, and `measuredAt` may be the same instant
in words. The library never cross-checks `measuredAt` against the period, because it never parses
`measuredAt`. A tool that knows only its retention states `held` as (read time − retention, newest
data); a tool that knows nothing says `'unknown'`.

### 3.3 How each door carries it

- **`absent({ …, provenance?, period? })`** — answers the request's open question ("absent() has no
  place for a source or a time"). An absence gains the same `provenance` `describedResult()`
  carries (the same camelCase input, the same snake_case wire, `measuredAt` and `source` both
  required once it is present) and the period. "Searched the 02:00 export — nothing" becomes
  `provenance: { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly export' }` plus a period whose
  `held.to` is 02:00. Why `provenance` and not only a period: the found branch and the not-found
  branch of ONE `execute` then carry their source and time in the same shape — the draft's example
  66 writes the export time into `checked` prose on both branches today.
- **`coverage(value, { …, period? })`** — the period only, inside `af_coverage`, serialized before
  `result` like the lists, so the agent's truncation keeps it. No `provenance`: a value that comes
  as rows from a system of record has `describedResult()` (Q2).
- **`describedResult({ …, period? })`** — a top-level `period` on `af_semantics`;
  `semanticsForModel` passes it through to the model.
- **`semantic()` gains nothing.** The deprecated door gets no new fields; its unknown-key refusal
  already refuses `period`, so its refusals stay the ones its deprecation fragment promises.

### 3.4 One rule set, two doors

`coverage/period.ts` (new) owns the rule, and every door asks it — the `coverage/items.ts` law for
`short` and `kind`:

- **At mint — refuse:** a missing or non-object `queried`; `from` after `to`; a string that is not
  an ISO 8601 instant with a zone; `held` that is neither `'unknown'` nor a `{ from, to }` pair by
  the same rule; `readAt` by the same rule; an unknown key; the snake_case `read_at` at a camelCase
  door, naming `readAt`. Every refusal starts `refused: `.
- **At recognition — read, never repair:** on `af_absent` and `af_coverage`, an invalid period is
  dropped from the record with a dev warning once per tool per process (`coverage/items.ts` ·
  `readItemExtras` is the precedent), while the model still reads what the tool wrote. On
  `af_semantics`, a period fault is one more `semanticIssues` fault, so the envelope stays data —
  that door's strictness law, unchanged.

### 3.5 The verdict — one pure rule, one row

```ts
type PeriodVerdict = 'covered' | 'partly-held' | 'not-held' | 'unknown';

/** Pure. Compares the instants the tool declared; bounds are inclusive. */
function periodVerdict(p: DeclaredPeriod): PeriodVerdict;
//   held === 'unknown'                                  → 'unknown'
//   held.from ≤ queried.from and queried.to ≤ held.to   → 'covered'
//   queried.to < held.from or queried.from > held.to    → 'not-held'
//   otherwise                                           → 'partly-held'
```

- **The fifth verdict, `undeclared`, is not a function of a period.** The results layer files it
  when the tool declares a `ToolPeriod` and this result carried no period: declared silence.
- **Where the declared period is recorded: the one coverage channel.** `CoverageFacts`,
  `DeclaredCoverage` (the tracked `coverageDeclared` row) and the `tools.absent` /
  `tools.coverage_declared` payloads gain `period?` (camelCase in the record, like `lookedFor`).
  `coverage/read.ts` · `readCoverageResult` absorbs a described result's period the way it absorbs
  its `coverage`; a described result with a period and no lists files a `'ledger'` row whose three
  lists are empty (pinned: every reader of the lists prints nothing new for it).
- **Where the verdict is recorded: the ledger.** The results layer (the subflow at the loop head,
  [README.md](README.md) § 5) reads this batch's committed calls (`toolResults`, which still holds the
  batch at the loop head), their coverage rows, and the run constant naming the tools that declare a
  `ToolPeriod`. It files one row per call that declared a period or whose tool declares a
  `ToolPeriod`: `{ kind: 'period', toolCallId, turn, verdict }` plus the ledger's usual stamps. The
  row references the coverage row by `toolCallId` and never copies the instants. Its event (name open) carries the tool name, the call
  id and the verdict word only.
- **Served:** nothing new. The model already read the declared period inside the tool's own result
  (§ 4). **The results layer adds no served bytes**: when it runs, the result is already in history,
  and served text belongs to the door (at mint, inside the tool's own result) or to the inputs
  layer's note.
- **For the person, under the existing `.limitsTravelWithTheAnswer()` only:** one `Period:` line per
  declaring call, from a versioned template over the row (*search_logs searched 08:00–10:00 UTC; the
  store holds data up to 02:00*). With no declared period, the block is byte-identical. From step 6
  the standing line owns this sentence when both arms are on (one composer for one fact).

### 3.6 Across versions and languages

- **The strictness asymmetry (§ 1.2) sets the cost.** An older reader serves a period on
  `af_absent` or `af_coverage` to the model as tool knowledge and files nothing. An older reader
  refuses the whole `af_semantics` envelope that carries one, and the model reads the raw envelope
  as data (dev-warned). Inside one JavaScript process, the helper and the reader are the same
  package, so this never happens. It happens across processes — a tool served over MCP by a newer
  library, or minted by a Python helper, and read by an older one — and in the lens, which reads the
  wire. So: the changelog names the floor, the lens learns the period before tools mint it, and the
  host pins both sides.
- **`canonical-notes.json`** gains the period's reserved key names and the literal `'unknown'`,
  generated from the barrel like the notes, so the host's Python helpers can mint it byte for byte.
- **Transport:** an envelope returned as JSON TEXT (an `mcpClient` result in its default text mode)
  is not recognized at the door at all (`coverage/read.ts` · `servedToModel`, header). The period
  inherits that: honest only under `resultMode: 'structured'` today (Q7).

### 3.7 The join with the inputs layer — and the nightly export

The two layers split one question. **The inputs layer owns WHO chose the period** (the argument
row: the person's words, their answer to the ask, or the tool's `assume` default). **The results
layer owns WHAT the read covered** (the declared period and its verdict). They join by
`toolCallId`, and neither parses the other's words.

| The question | The call | The result's period | Verdict | The standing reads |
|---|---|---|---|---|
| "Any errors in checkout?" (no period said) | `search_logs({ service, window: '2h' })`, `window` assumed by the tool's rule | queried 08:00–10:00, held 30 days | covered | *Not sure — searched 08:00–10:00 UTC, the 2 hours the tool's rule assumed; you did not give a period.* (`argument-assumed`, layer 2) |
| "Any backup failures in the last hour?" | `backup_runs({ window: '1h' })`, the person's words | queried 09:00–10:00, held up to the 02:00 export | not-held | *Not sure — the data ends at 02:00; the hour you asked about is after it.* (`period-not-held`) |
| "Errors in the last 30 days?" | `search_logs({ window: '30d' })` | queried 30 days, held 7 days | partly-held | *Not sure — the store holds only the last 7 days of the 30 searched.* (`period-partly-held`) |
| any | a tool with a `ToolPeriod` returns a bare `[]` | none | undeclared | *Not sure — the tool declares a period argument but did not say what its read covered.* (`period-undeclared`) |

The second row is the freshness gap closed for time-bounded reads, with no phrase parsing: the tool
computed its queried period from its own argument, and the export's time bounds what it holds. A
question with no time bound ("which VMs are on datastore X?") has no period; its freshness stays in
`measuredAt`, words for the model, and no check reads it (§ 9, gaps).

**Named, not proposed for v1: `narrower-than-asked`.** A tool that silently clamps `30d` to `7d`
declares a queried period shorter than the argument asked. Catching it needs the duration of a
DECLARED lookback spelling — a machine format the author declared, not the person's words — but it
bends "the library never parses '2h'" (Q6).

---

## 4. The served view — which parts reach the model

### 4.1 One rule, three outcomes

**Rule: each door serves the ground its value cannot show for itself, and never a record-only key
or a UI hint. The record keeps everything.**

| Field | `absent()` | `coverage()` | `describedResult()` |
|---|---|---|---|
| the data | — (there is none) | `result`, untouched | `series` / `facts` / `edges` |
| `checked` | **served** | **served** | **record only** (and the limits block) |
| `not_checked`, `cannot_cover` | served, as lists | served, as lists | served as the composed `not_covered` lines ("what — why") |
| `short`, `kind` on items | stripped | stripped | stripped |
| `looked_for` | served, never evidence | — | — |
| `try_instead`, `try_instead_tool` | served | — | — |
| `grain` | — | — | served |
| `provenance` | served (from 7b) | — (Q2) | served |
| `period` | served as declared (7b) | served as declared (7b) | served as declared (7b) |
| `clarify` | — | — | served when non-null; `null` is record only |
| `render` | — | — | record only |
| the marker | served (`af_absent: true`) | served (the `af_coverage` object) | dropped |
| the static note | `ABSENCE_NOTE` | `COVERAGE_NOTE` | `SEMANTICS_NOTE` (Q3) |

### 4.2 The request's question: why `describedResult()` does not serve `checked`

The request asks whether it is intentional that the model never sees `describedResult()`'s
`checked` list while `absent()`'s reaches it. **Yes — it follows from the rule, and the docs should
say so in these words:**

- `absent()` has no rows. `checked` is the whole scope of "nothing matched", so it is served.
- `coverage()` wraps an opaque value ("2 of 2 backup runs succeeded"). The value cannot show what it
  covered, so `checked` is served.
- `describedResult()` carries typed rows, and each row names its entity. The part that stops an
  overclaim — the ground NOT covered — is served as `not_covered`. The positive population
  statement stays in the record and in the limits block (`lib/semantics/envelope.ts` header: "the
  model reads the composed `not_covered` lines instead").

**The named risk: the completeness of a listing.** "Every VM in the export" is what tells a reader
that a listing is complete. Without it, the model cannot tell "these are all" from "these are some"
unless the author declared the gap — the `resultClass: 'inventory'` concern in the gate's own advice
("An inventory that cannot say which population it covered reads as the whole fleet",
`lib/semantics/check.ts` · `classCoverageFinding`). Bench cell R4 (§ 7) measures it. On a gain, the
choice is:

- serve `checked` in the projection for every envelope that declares it — a served-bytes change for
  existing `semantic()` tools (a `changed` fragment and new byte references, not a new arm); or,
- if the token cost matters, serve it only for tools that declare `resultClass: 'inventory'` — a
  tool declaration serving bytes inside its own results, which clause 7 allows.

### 4.3 The request's question: a shorter note when there is no series

`SEMANTICS_NOTE` is 329 characters and rides every described result, even a one-row lookup. Its
three clauses are about `grain`/`is_counter`, `measured_at`/`age_seconds`, and `not_covered`.

**Proposal (owner's call, Q3):** compose the note from static clauses by which fields the envelope
carries — the grain clause only with `grain`, the provenance clause only with `provenance`, the
`not_covered` clause only with `not_covered`. Constraints:

- **No interpolation.** Each clause is static library text, so "nothing of the caller's to leak"
  still holds (`coverage/absent.ts`, header).
- **An envelope with grain, provenance and declared gaps reads today's note byte for byte.** The
  clauses split the current sentence; only envelopes missing a field lose the clause about it (a
  series always has grain and provenance, so a series loses at most the `not_covered` clause).
- **Wire-compatible.** The recognizer accepts any string note (`semanticIssues`: "a string, or
  omitted") and the projection serves the minted one, so an older reader serves a shorter note as
  it is.
- **Not in the rename PR.** It changes what `semantic()` mints, and the request's acceptance says
  `semantic()` output stays byte for byte. It ships as its own `changed` fragment, with the byte
  references updated and the clauses and their order published in `canonical-notes.json` for
  foreign minters.
- **Measured first:** characters and tokens per call over recorded runs, offline. A hosted cell (R5)
  only if the owner wants one; the clauses removed describe fields the envelope does not carry.

### 4.4 What no door adds

- **No period sentence.** The period is served as the data the tool declared; `"held": "unknown"`
  reads as what it is. A derived verdict word on the wire ("held covers: part") is rejected for v1
  (§ 9) and returns only if cells R1/R2 show the model misreading instants.
- **Nothing from the results layer.** It records verdicts and serves nothing (§ 3.5).
- **The inputs layer's past-tense note** (*"window was not in the search_logs call this result
  answers; the call ran with "2h" …"*) is library text appended to the served result. It belongs to
  [inputs.md](inputs.md); this layer's only duty is the boundary it states: library-written notes are never
  searched as evidence.

---

## 5. The fold — how the answer's standing reads each door

The fold is [README.md](README.md) § 4.2: four values (known · unrefuted · unknown · not-applicable),
rendered known · consistent with the record · not sure · ask · not assessed. It reads this turn's
committed rows only, never events, and no layer-3 row can support "known" — only layer 4's tie
checks can. This section says what layer 3 hands it.

### 5.1 Today: `readEmptiness` reads an envelope as "returned a result"

`lib/answer-account/facts/common.ts` · `readEmptiness` has three typed routes and never guesses: a
declared absence; a top-level array (counted by the library); an object whose key the app declared
in `rowsAt` (counted by the app). Everything else is `unknown`, and the account says
"`{{tool}}` returned a result." (`lib/answer-account/templates.ts`, `found.result`). It reads what
the MODEL read (`modelResult ?? result`, `facts/calls.ts` · `readOne`). Two consequences:

- a `describedResult()`: the model read the projection, which carries no marker, so it reads
  `unknown`;
- a `coverage()` envelope: an object with no `rowsAt`, so `unknown` — even around an empty rowset.

### 5.2 One emptiness reader, two callers

Move the rule to ONE owner beside the recognizers — `coverage/emptiness.ts` · `readEmptiness`,
importing only the recognizers, so a post-hoc reader can load it without the mints (the reason
`coverage/recognize.ts` was split out for the account) — and add typed routes,
still never a guess. It takes the value the model read and the door the record says the call
returned (the coverage rows; for the account also the `tools.semantics_declared` event; from step 8
the outcome row):

| What the record says came back | Reading | Rows counted by |
|---|---|---|
| an absence — bare, inside a `coverage()`, or delivered status `'absent'` | `declared-absent` | — |
| a `coverage()` envelope | its wrapped `result`, read by these same routes and marked `bounded`; an empty wrapped rowset reads `declared-absent` — the same meaning as an absence, so the same reading | library or app |
| a `describedResult()` with data | `non-empty`, with a count per kind (`facts`, `series`, `edges`) | library |
| a `describedResult()` with only `clarify` | `clarify` — a question handed back, no data | — |
| a bare top-level array | `empty-undeclared` or `non-empty` | library |
| an object whose key the app declared in `rowsAt` | `empty-undeclared` or `non-empty` | app |
| anything else | `unknown` — the record cannot read it | — |

**Both callers use it:** the `/observe` answer account (its "It found" sentence gains a described
template — *`backup_runs` returned 2 facts from the backup API export, measured
2026-08-19T10:12:00Z*, each value vouched for by the tool) and the standing fold (step 1). One rule,
so the person's account and the answer's standing cannot disagree about what came back.

### 5.3 What the fold reads, per door

| This turn's call returned | Reasons layer 3 can fire | Counts as "a check ran" | Can support "known" |
|---|---|---|---|
| `absent()` | `declared-absent`; `coverage-gap` (any `not_checked` / `cannot_cover`); a period reason | yes | never |
| `coverage()` | `coverage-gap`; `declared-absent` when its wrapped rowset is empty; a period reason | yes | never |
| `describedResult()` | `coverage-gap` (its coverage row); a period reason | yes | never here; its `claimFacts` feed layer 4's `.claims()` tie check, which can |
| a bare empty rowset | `empty-undeclared` | yes | never |
| a bare non-empty rowset | none | yes | never |
| any other bare shape | none | no — not applicable | never |
| a tool with a `ToolPeriod`, no period on the result | `period-undeclared` | yes | never |

The period reasons are `period-partly-held`, `period-not-held`, `period-unknown` and
`period-undeclared` (§ 3.5); `covered` fires none.

**Proposed addition (Q5): `coverage-undeclared`.** A tool that declares `resultClass: 'triage'` or
`'inventory'` is held to declaring coverage only in the `check:semantics` samples today; nothing
reads `resultClass` at run time (it is read in `core/tools.ts` and `lib/semantics/` only). The
results layer can hold every run to the tool's own declaration: a result from such a tool that
files no coverage row fires `coverage-undeclared`. It is declared silence — rule 4 of the fold — on
a declaration that already exists and already travels over MCP.

**How they read to the person** (versioned templates; layer 4 owns the rendering):
- `declared-absent`: *Not sure — backup_runs searched every backup job in the 02:00 export and found
  none for host-999; it cannot see the second backup product.*
- `period-unknown`: *Not sure — search_logs does not know whether its store holds 08:00–10:00.*
- `empty-undeclared`: *Not sure — list_ports returned nothing and did not say what it searched.*

### 5.4 Committed rows only — what that costs before step 8

- **A described result is only half in committed state.** `stages/toolCalls.ts` ·
  `declareSemantics` replaces the envelope with its projection right after the coverage funnel has
  read it ("after that the typed object exists nowhere a check could read it"). History holds the projection, with
  no marker; the full envelope is on an event. So at step 1, a described result without coverage
  reads `unknown` for emptiness. It is never empty (its arrays are non-empty by construction), so
  the loss is one "a check ran" count, never a false reason.
- **A decorated history string does not parse.** The step suffix, effect notes and the
  repeated-call note are appended AFTER the cap, so the served string in history may no longer be
  JSON, and it reads `unknown`.
- **Both go away at step 8.** The outcome row per call ([README.md](README.md) step 8) records the door,
  its counts and the emptiness reading ONCE, at the one landing funnel, from the value before
  decoration — record during traversal, never post-process. From then on every reader reads the row.

### 5.5 The paper

Layer 3 is the paper's evidence: RQ3's FOUND / DECLARED-ABSENT / NOT-COVERED / UNKNOWN standings map
onto this reader ([README.md](README.md) § 4.3), and step 1's parity test runs both over the study's
recorded runs. The period and `describedResult()` are not in the study's frozen library version (the
host pins 9.116.0), so they go under Future Plans as a falsifiable claim: *declaring the held period
moves stale-export answers from "consistent" to "not sure" without adding needless hedges on
controls*.

---

## 6. Migration — the rename PR (step 7a)

### 6.1 The house law, and where the draft stands

The draft (first seen as 55 uncommitted paths; now one local commit, `d8258fd3`, 54 files, on the
branch `feat/described-result`, not pushed) covers the whole of step 7a. This table checks it
against the request. "Present" means found in the draft by this pass; nothing here was run.

| The request asks | The house law | In the draft (`d8258fd3`) |
|---|---|---|
| one core, two doors | `describedResult(decl)` respells and calls the core; `semantic(decl)` passes through; each door's refusals quote its author's spelling | present: `lib/semantics/envelope.ts` · `mintSemantics` with a `DeclarationDoor` per door; `lib/semantics/described.ts` · `DESCRIBED_DOOR` |
| camelCase in, unchanged wire out | per-object rename tables tied to BOTH types, so a field with no wire name fails to compile | present: `GRAIN_NAMES`, `PROVENANCE_NAMES`, `RENDER_NAMES` with `satisfies` |
| one spelling per door, never both | the other spelling is refused, naming the one meant | present, with tests ("neither door takes both spellings at once") |
| no `measuredAt` alias in `semantic()` | — | none added |
| input type split from the wire type | internal camelCase shapes, not exported by name | present: `DescribedGrain`, `DescribedProvenance`, `DescribedRender` (`@inline`) |
| a missing source is a compile error | a conditional type, `@ts-expect-error` pins | present: `DescribedResultDeclaration`'s intersection; 8 pins in `test/type-regressions/DescribedResult.assignability.test.ts` |
| keep the wire, the note, the notes file, the recognizers, the gate's name, the 17 types | — | kept |
| the gate's advice names the new door | `lib/semantics/check.ts` · `classCoverageFinding` | present, with a regression test |
| a 9.x minor; `@deprecated` in TSDoc only; no warning | fragments `added` + `deprecated` | present: `.changes/described-result.md`, `.changes/semantic-deprecated.md` |
| the decision table; "where it lives"; values from the data; retitle "Semantic tool results" | Tools page, README, SKILL.md | present: `docs-next/content/docs/build/tools.mdx` (with captured model views), the retitled `semantic-results.mdx`, README, both SKILL.md copies, example 66 |
| golden test: facts, series with grain, edges, clarify-only, render | camelCase ⇒ the same bytes as snake_case | present: unit pins plus a property test over 3,000 declarations |
| the model reads a refusal that reads as one; the run continues | a run test | present: an integration test through the real loop |

**Before it merges** (not verified by this pass): the full suite with the existing `semantic()`
pins unchanged; the 21 byte references in `test/core/tools/reference/`; the docs site budget
measured after the last code change (the draft adds two generated API pages,
`describedResult.md` and `DescribedResultDeclaration.md`, and the budget counts export files);
`docs:truth:report` last. The owner's rule that these notes are reviewed before any branch, PR or
implementation is the reason the draft is Q8.

### 6.2 What does NOT ride the rename PR

- **The empty-data message (§ 1.3).** The deprecation fragment promises `semantic()` "the same
  refusals", and the core is shared, so it ships after 7a as its own `fixed` fragment.
- **The period, and `provenance` on `absent()` (7b).** A wire addition, with the cross-version cost
  of § 3.6.
- **The composed note (§ 4.3, 7c).** It changes what `semantic()` mints.
- **The one emptiness reader (§ 5.2).** It ships with step 1, which is its first caller.

### 6.3 Downstream (unchanged from the request)

- The video course re-pins to the release that ships `describedResult()` (six places say 9.114.0),
  adds a test that the pin and the source agree, switches its 02B example, and re-captures.
- The host app: one test and two docs.
- The lens: nothing for 7a (it reads the wire). For 7b it must learn `period` before any tool mints
  one (§ 3.6).

---

## 7. The steps — this layer's slice of the plan

Numbers are [README.md](README.md) § 7's. Each step: all seven test types (a type that does not apply
is named), the byte references unchanged when nothing is declared, every new sentence registered,
a CAPABILITIES row, a `.changes` fragment, the docs-next page, an example, `npm run docs:regen`.

| Step | Ships (result layer) | Arm (off ⇒ byte-identical) | Needs |
|---|---|---|---|
| 1 | `coverage/emptiness.ts` · `readEmptiness` (one owner); the answer account and `assessAnswer` both call it; the account's described template | none — readers only | — |
| 7a | `describedResult()` (drafted, § 6) | a new door | — |
| 7a′ | the empty-data refusal names `absent()` (§ 1.3) | refusal text only | 7a |
| 7b | `coverage/period.ts` (the rule and `periodVerdict`); `period` on the three doors and `provenance` on `absent()`; the coverage channel carries `period`; `canonical-notes.json`; the results subflow at the loop head, its period rows and reasons; the `Period:` line under the existing limits arm; the lens reads `period` | a result declares `period`, or its tool a `ToolPeriod` | 1, 3 — the `ToolPeriod` ships with step 3, owned by `arguments/`, and is refused without an argument rule ([inputs.md](inputs.md) § 1.3; Q12 below) |
| 7c | the composed note (§ 4.3) | none — a `changed` fragment, owner's call (Q3) | 7a |
| 8 | the outcome row per call at one landing funnel: the door, its counts, the emptiness reading, refused / errored / truncated / placed; `coverage-undeclared` (Q5); fact-in-result; `expectation-missed` | the results layer | 5, 7b |

**The folders.** `coverage/` keeps the doors and gains `period.ts` and `emptiness.ts` (their rules
stay with their data). `results/` (new) holds only the subflow — Declare → Verify → Record →
Resolve — and its README: *A result says what it covered, its period included; silence about a
declared period is recorded as silence.* `lib/semantics/` keeps `describedResult()`. The layer's
design page is this one, placed by step 0 at `docs/design/honesty/results.md`.

---

## 8. Benchmark — and what this layer lets you measure

### 8.1 The cells

The protocol is [README.md](README.md) § 6.1: provoking cases and controls, a baseline without the
change, a success rule registered before the first paid call (with a non-inferiority margin on
needless hedges and on correct answers), same-day interleaved runs on a fresh seed, verdicts from
blind hand labels only, Haiku 4.5 only inside a budget the owner approves per run, and a change
kept only on a gain. Measured nulls to respect: the served findings piece showed no benefit at ten
runs and cost fact fidelity (facts-in-answer 1.000 → 0.917); Haiku declared about half the time.

| Cell | Provoking case | Control | Baseline | What the registered rule compares |
|---|---|---|---|---|
| R0 · rename | — | — | — | not a bench: the wire is identical, so golden and property tests decide (§ 6.1) |
| R1 · stale export | "any failures in the last hour?" answered from a 02:00 export | the same question inside the held period | the same tool with the time only in `checked` prose | the share of flat "no failures" answers on provoking cases; needless hedges on controls |
| R2 · short retention | "errors in the last 30 days?" from a store that holds 7 | a 24-hour question | no period | answers that scope their claim to what the store holds |
| R3 · held unknown | a tool that declares `held: 'unknown'`, empty and non-empty results | the same tool with `held` known | — | answers that say they cannot tell whether the period was held; the false-"not sure" rate on non-empty results (decides Q1) |
| R4 · served `checked` | an inventory whose partial population is declared only in `checked` | a complete population | today's projection (no `checked`) | scope statements ("these are the N in the export") against fact fidelity, which must not fall |
| R5 · composed note | facts-only lookups | series with declared gaps (whose note is unchanged) | the full note | tokens per call; fact fidelity; `is_counter` misuse on series (only if the owner wants a hosted cell, Q3) |

R1 and R2 also decide whether a derived verdict word on the wire earns its bytes (§ 9): only if the
model misreads the declared instants.

### 8.2 What it lets you measure — from the record alone

Per tool, per model, and per prompt or skill version, the same rows the bench, the paper and the
lens read:

- **the door mix and declaration rate** — bare, `absent()`, `coverage()`, `describedResult()` — per
  tool and per result class;
- **the unreadable share** — results whose emptiness reading is `unknown` (the record cannot say
  whether anything came back);
- **the empty-undeclared rate** — empty results that did not say what they searched;
- **the period declaration rate** among tools that declare a period argument, the **period verdict
  mix**, and the **held-unknown share** (stores their tools cannot vouch for);
- **answers that claim past their period** — a flat claim on an answer with a `period-partly-held`
  or `period-not-held` reason (layer 4's "exceeds its standing", restricted to period reasons);
- **the provenance rate on absences** — how often "nothing" says from which source and when;
- from step 8: **refusals per door in production** (a declaration that fails only on live data),
  errors, truncations and placements per call.

**The limit.** This measures honesty — claims within what the record covered — not truth. `absent()`,
`coverage()` and the period are trusted tool declarations: a tool that misstates what its store
holds produces an honest-looking standing. The study checks that from outside the library (its G1
gate against the seed, and the sealed side log that keeps every declared result).

---

## 9. Considered and rejected

| Proposal | Why not |
|---|---|
| `typedResult()` | "typed" collides with `runTyped()` (owner decision) |
| `found()`, `sourced()`, `evidence()`, `observed()`, `result()` | the request's table: contradicted by the library's own words, collisions, or a poor fit for edges and clarify-only results |
| a `measuredAt` alias inside `semantic()` | two spellings in one door; a half-migrated call would mint silently |
| `semantic()` gaining `period` | a deprecated door gains no fields |
| the period as `CoverageItem.kind: 'window'` | a kind is a closed, record-only word; it cannot hold instants to compare |
| the word `window` | it names the context window |
| deriving the period from `measuredAt` | `measuredAt` is never parsed ("last year, roughly" passes) |
| a per-bound unknown (`held: { from: 'unknown', to }`) | two comparison rules for one question; a tool that knows its retention can state both bounds, and one that does not says `'unknown'` |
| a derived verdict word on the wire in v1 ("held covers: part") | a served-bytes change with no bench behind it, and a second implementation in every foreign minting helper. If R1/R2 show the model misreading instants, it returns on the `not_covered` precedent: derived at mint, refused on disagreement at recognition |
| composing coverage items from the period (library prose inside the author's lists) | tool declarations stay in their own keys, and library-written text never grounds |
| stamping the period verdict on the coverage row inside ToolCalls | a library verdict inside a tool-declaration row; verdicts are ledger rows, filed by the layer (law 8) |
| the results layer appending a note to the result | the result is already in history when the loop head runs; served text belongs to the door (at mint) or to the inputs layer's note |
| `describedResult()` accepting empty data as an absence | two doors for one meaning; the non-empty law keeps "nothing matched" to `absent()` |
| serving `describedResult()`'s `checked` now | benchmark first (R4), and the findings-piece null says served bytes can cost fidelity |
| reading the fold's emptiness from events | the fold reads committed rows only, so the running agent and a later reader fold the same bytes |
| recognizing JSON-text envelopes in the fold alone | the run did not recognize them; with one owner, the fix belongs at the execute boundary (Q7) |

### 9.1 Gaps this page leaves open, and where each goes

| Gap (checked in code) | Goes to |
|---|---|
| Tool errors are untyped in the model-facing record: no error marker on the history message, no provider sets `is_error`, error text grounds identifiers ("host srv-99 not found"), and the offer treats an error as a result | step 8's outcome row; forwarding `is_error` is the request's separate, larger item |
| Truncation is not carried into the standing: the evidence corpus and the offer read a verbatim head as full data, and `'partial'` carries no counts | step 8 (`result-truncated`); typed counts (rows returned of total) are not designed here |
| Placement drops the boundary from the wire: a `coverage()`-wrapped payload is placed whole, and the ticket carries no `not_checked` | not designed here |
| The limits block merges every coverage row of the run, including results the model set aside, and `coverageDeclared` is not carried into the next turn | layer 4 ("rests on", step 6) |
| A typed `tryInsteadTool` is joined to nothing | layer 1, step 9 (`source-not-consulted`) |
| `kind: 'existence'` has no run-time reader | on hold with the [honest-answer page](../2026-09-honest-answer-ledger.md)'s existence claims |
| `clarify` is data only | stays so (a clarify never pauses); a reason is Q10 |
| Freshness for questions with no time bound | `measuredAt` words only; no check without a declared bound |
| Honesty depends on the transport (JSON text is not recognized) | Q7 |
| A hand-written composite tool can swallow an inner absence (`core/agent/toolDispatch.ts` · `agentToolDispatch` returns inner results raw; only `runbookAsTool` folds inner coverage) | not designed here |
| The declaration itself is trusted: nothing ties `checked` or `held` to what the tool really queried | the study's sealed side log, from outside |
| No run-level empty fold ("every lookup this run was empty, N of N") | countable from step 8's rows; no reason proposed |
| A raised absence (`requestInput({ absence })`) gets no ceiling, column check, evidence or status | unchanged; its rows ride the checkpoint |

---

## 10. Open questions for the owner

**Answered 2026-09-27.** Each question below took its recommended answer (adopted overnight on the
owner's go; the owner may overturn). In [decisions.md](decisions.md) they are Q33 (1), Q34 (2),
Q35 (3), Q36 (4), Q38 (5), Q39 (6), Q40 (7), Q37 (8), Q41 (9), Q42 (10), Q43 (11) and Q13 (12). The
questions stay here as they were put.

1. **`held: 'unknown'` on a non-empty result.** A reason that makes the answer "not sure" (this
   page's default — an average over a period the store may not hold is an average over less), or a
   lens line only, so "not sure" does not fire on every answer from a store whose retention nobody
   declared? R3's false-"not sure" rate decides.
2. **`provenance` on `coverage()` too**, so all three doors carry source and time the same way — or
   only `absent()` and `describedResult()` (this page), because a value that comes as rows from a
   system of record already has its door?
3. **The composed note (7c).** Ship it after an offline token count, or keep one static note? A
   hosted cell (R5), or is the offline count enough, given that only clauses about absent fields go?
4. **`describedResult()`'s `checked` list.** Keep today's projection (this page) until R4 shows a
   gain? On a gain: serve it for every envelope that declares it, or only for tools that declare
   `resultClass: 'inventory'`?
5. **`coverage-undeclared`** — hold `resultClass` tools to their own declaration at run time
   (step 8), not only in the build gate's samples?
6. **`narrower-than-asked`** — may the library read the duration of a DECLARED lookback spelling to
   catch a tool that silently clamps its window, or does that cross "never parses '2h'"?
7. **JSON-text envelopes** (an MCP client in text mode): recognize them at the execute boundary —
   one owner, and a served-bytes change for text-mode tools that return envelopes — or keep "use
   `resultMode: 'structured'`" as the documented rule?
8. **The 7a draft** (§ 6.1), now one local commit `d8258fd3` on the unpushed branch
   `feat/described-result`: review it and open it as the rename PR, or set it aside until this page
   is decided? It was not made by this design pass.
9. **The empty-data message (§ 1.3):** its own fix after 7a (this page), or folded into 7a with
   "the same refusals" removed from the deprecation fragment?
10. **A `clarify-open` reason at step 8** — "the tool handed back a question and the answer did not
    settle it". It over-reports in v1, because a later call may have settled it. Add it, or leave
    `clarify` as data only?
11. **Names, all open:** `period`, `queried`, `held`, `readAt`, the literal `'unknown'`; the verdict
    words (`covered`, `partly-held`, `not-held`, `unknown`, `undeclared`); `coverage/period.ts`,
    `coverage/emptiness.ts`; the `period` row kind and its event; the account's described
    template.
12. **A `ToolPeriod` on an argument with no rule** (the architecture note's Q19): refused today, so
    `period-undeclared` reaches only tools that rule their period argument. Keep the refusal in v1,
    or allow a period on a free argument?

---

## Appendix — facts this page rests on, checked in code on 2026-09-26

Committed code (9.118.1) unless marked "draft":

- `absent()` mints `af_absent`, `outcome: 'nothing_found'`, `looked_for`, the lists,
  `retry_returns_the_same`, `try_instead`, `try_instead_tool` and `ABSENCE_NOTE`
  (`coverage/absent.ts` · `absent`); its declaration keys are tied to `AbsenceDeclaration`
  (`ABSENCE_DECLARATION_KEYS`) and it has no source or time field.
- `readAbsence` asks only for the marker and a non-empty `checked` (`coverage/recognize.ts`);
  `readCoverageLedger` only for an `af_coverage` object and a `result` key (`coverage/ledger.ts`);
  `semanticIssues` refuses any key outside its vocabulary and any empty `series`, `facts` or
  `edges`, and accepts any string `note` (`lib/semantics/envelope.ts`).
- The projection drops the marker, `render`, the three coverage lists and a null `clarify`, and
  keeps the composed `not_covered` (`lib/semantics/envelope.ts` · `semanticsForModel`);
  `declareSemantics` replaces the envelope with it before the ceiling, and files the full envelope
  on `tools.semantics_declared` first (`stages/toolCalls.ts`).
- `servedToModel` strips `short`/`kind` and does not read JSON text (`coverage/read.ts`);
  `readCoverageResult` absorbs a described result's `coverage` into the one coverage channel and
  returns nothing for one without it.
- `declareCoverage` files `tools.absent` (with `tryInstead`, `tryInsteadTool`) or
  `tools.coverage_declared`, and `coverageDeclared` rows without the suggestions
  (`stages/toolCalls.ts`).
- `evidence.ts` withholds `looked_for`, `short` and `kind`; everything else a recognized absence
  carries grounds (`coverage/evidence.ts`, header).
- `readEmptiness` has three typed routes and reads the model's view; the account's fallback sentence
  is "returned a result" (`lib/answer-account/facts/common.ts`, `facts/calls.ts` · `readOne`,
  `templates.ts`).
- `resultClass` is read at definition (`core/tools.ts`), copied by `runbookAsTool`, and judged only
  by the `check:semantics` gate; no stage reads it at run time.
- The notes are 385 (`ABSENCE_NOTE`), 318 (`COVERAGE_NOTE`) and 329 (`SEMANTICS_NOTE`) characters;
  `canonical-notes.json` holds notes, markers and headings, generated by
  `scripts/gen-canonical-notes.mjs`.
- The two facts the request's house law fixes, as committed: `SemanticDeclaration.provenance` is
  optional, and `SemanticProvenance` is both the declaration's type and `ToolSemantics.provenance`
  (`lib/semantics/types.ts`).
- `toolResults` is reset at the start of every ToolCalls batch and filled during it, so the loop
  head still sees the batch just run (`stages/toolCalls.ts`).
- The host's time-series tools return `data_window: { window, range_end }`, with no held period
  (`host:py-tools/server.py`).
- Draft (local branch `feat/described-result`, commit `d8258fd3`, not on main): `lib/semantics/described.ts` · `describedResult`; `envelope.ts` ·
  `mintSemantics`; `types.ts` · `DescribedResultDeclaration`; the two `.changes` fragments; the
  tests named in § 6.1.

---

## What the results layer lets you measure

From the record alone, per tool, per model and per prompt or skill version: which door each result
came through and how often a tool declares what it covered; the share of results the record cannot
read; how often an empty result said nothing about what it searched; how often a tool with a period
argument said what its read covered, and whether the store held it (covered, partly held, not held,
unknown); how often "nothing" names its source and time; and how often an answer claims more than
its period covered. The same rows feed the bench, the paper's layer-3 evidence and the lens. They
measure claims within what the record covered — not whether an answer is true, and not whether a
tool's own declaration is true (the study checks that from outside).
