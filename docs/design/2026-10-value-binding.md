# Value binding (V1) — a value counts only with its subject, field, unit, window and coverage

**Design for review. Not approved to implement.** Nothing in this page is built. Written
2026-10-29 from the revised V1 requirement. The owner approved starting the design; the
owner and Codex review it through the review exchange, and the build follows in its own PR
after that review.

Code is cited as `file` · `symbol`, under `src/`. A name marked † does not exist yet: it is
this page's proposal, and the build may rename it. Examples use neutral subjects (customers,
nodes); "the host app" names the app the field report came from.

## For the owner

- The names-and-numbers gate proves a value APPEARED in a result. It cannot prove the value
  BELONGS to the subject the answer names. Codex's probe: a result said "Customer A: balance
  1200" and the gate accepted "Customer B owes 1200". The field case: a CPU reading from
  another node, or another hour, counted as support for "node X's CPU in the last hour".
- V1 checks a value together with its subject, field, unit, time window and coverage. It
  works only on claims the record can read without guessing: a typed answer field the app
  declares as a claim, bound to a row of a result that declares what each value is about.
  Free prose stays under the membership check; under a contract, the account names the
  fields V1 did not bind.
- Every statement the check can place is labelled one of four kinds: **observed** (a row
  carries it), **calculated** (the library recomputed it from observed rows), **interpretation**
  (the model's reading of observed values), **missing** (the record holds no value for it).
  A bound value that disagrees with its row is **contradicted**.
- V1 is opt-in and stronger than names-and-numbers. Both run; neither widens the other.
- The model's honesty is not assumed anywhere. The app declares which fields are claims; the
  tool declares what its rows are about; the library binds. The model never names the
  evidence.
- Nothing here is byte-identical for an app that declares a scoped contract. An app that does
  not is unaffected.

## 1. Why

The gate is lexical by design (`core/agent/evidence/README.md`, "What it is not"): set
membership over normalized tokens, no second model. That gives determinism and a small cost,
and it catches invented values. It cannot see a false claim assembled from real values. Two
cases show the gap it leaves for a value that is real but about something else:

| Case | The result | The answer | The gate |
|---|---|---|---|
| Codex's probe | `{ customer: 'A', balance: 1200 }` | "Customer B owes 1200" | `1200` is carried: grounded |
| The field case | per-node CPU rows for two hours, several nodes | "node 7 averaged 87% over the last hour", where 87 is node 9's reading at 07:40 | `87` is carried: grounded |

The figures dial names the same limit for its arithmetic (`core/agent/evidence/figures.ts`,
header): "59.2% used is accepted as the ratio of two columns even if the person asked about
one pool". The claim seam names it for `.claims()`
(`answer-validation/agentChecks.ts` · `claimChecksOf`): the contract is unscoped, rows for
`(entity, field)` from any tool, so agreement verifies nothing. H1's design left the room
(`2026-10-script-artifact.md`, § 11): no field on any row or event says what a value is
ABOUT.

The owner's north star is an answer that says known, not sure or ask, and why, from the
record. "Known" needs a row that supports it (`core/agent/assessment/README.md`, "The law").
A membership pass never supports. V1 is the check that can: a value bound to the subject,
field, unit and window the claim is about, with the coverage of the read that returned it.

## 2. What exists, and what this design builds on

| Piece | Where | What V1 does with it |
|---|---|---|
| The gate | `core/agent/evidence/gate.ts` · `checkAnswer`; the corpus `evidenceIndex.ts` · `evidenceFromHistory`; the carriers `EvidenceCorpus.carriers`, `answerCarriers.ts` · `answerCarriersOf` (`evidence_checked.carriedBy`) | Unchanged. V1 never widens it (§ 8). |
| A typed answer, read value by value | `extract.ts` · `readAnswer`, `answerTexts`; the Route judge `core/agent/stages/route.ts` · `readValidatedAnswer` | The claim side: V1 reads the typed field itself. |
| The claim contract | `core/agent/AgentBuilder.ts` · `claims()`; `integrity/unsupported-claim/check.ts` · `compareClaim`, `DeclaredClaim`, `ClaimLedgerRow`; `delivered.ts` · `judgeDeliveredClaim`; `evaluate.ts` · `evaluateClaimPair`, `compareClaimValues` | Extended with the scoped form of #195 and V1's parts (§ 4). The short form keeps #195's ruling: it may fail, it never verifies. |
| Answer validation and the agent's own rows | `answer-validation/validate.ts` · `executeAnswerValidation`; `agentChecks.ts` · `claimChecksOf`, `evidenceCheckOf`, `AGENT_CHECK_PREFIX`; the stage `core/agent/stages/answerValidation.ts` · `withAnswerValidation`; `agentChecks: ['claims']` (#197) | The seam V1 runs at: the delivered candidate. |
| The semantic envelope | `semantics/described.ts` · `describedResult`; `semantics/types.ts` · `ToolSemantics`, `SemanticFact` (`entity` required), `SemanticSeriesPoint` (`t`, `entity`, `metric`, `value`), `SemanticGrain` (`interval`, `aggregation`, `is_counter`), `SemanticProvenance` (`measured_at`, `source`) | The first result shape that binds (§ 5). It already says what each row is about. |
| Resolved population values | `semantics/coverage/search/resultFacts.ts` · `ResolvedDeclaration` (`argument`, `id`, `name`, `aliases`); on the composed row `semantics/coverage/composedCoverage.ts` · `ComposedItem.resolved` | How the person's subject word is joined to a row's subject (§ 4). |
| Composed coverage and result identity | `composedCoverage.ts` · `ComposedCoverage` (`resultId`, `handle`, `complete`, `gaps`, `period`); `Tool.search` (`semantics/coverage/search/types.ts` · `ToolSearch`, `SearchRole`) | The coverage a bound value inherits, and the one result identity (never a provider call id). |
| The period a read covered | `semantics/coverage/period.ts` · `DeclaredPeriod`, `periodVerdict`, `PeriodRow`; the results layer `core/agent/results/subflow.ts`; under `.time()` `time/check.ts` · `periodTimeCheck`; the executed window `time/rows.ts` · `CallWindowRow` | The window rule (§ 6). V1 adds no second period law. |
| Declared columns | `tools/tools.ts` · `DefineToolOptions.resultColumns`; `integrity/column-types/types.ts` · `ToolResultColumns`, `ColumnDeclaration`, `ColumnType` | The second result shape that binds, once columns carry a role and a unit (§ 5). |
| Units and precision | `core/agent/evidence/figureUnits.ts` · `FIGURE_UNITS`; `numberPrecision.ts` · `roundsTo`, `decimalsOf`, `scientificDecimalOf`; `figures.ts` · `explainFigure` (the closed derivation set) | The unit vocabulary and the one rounding rule; the `unit-scale` derivation. |
| Instants | `time/instant.ts` · `instantOf`, `compareInstants` | Every time comparison. |
| The standing | `core/agent/assessment/assess.ts` · `assessAnswer`; `reasons.ts` · `REASONS`; `sources.ts` · `reasonSourceOf`; `compose.ts` · `standingLineOf` | Gains two reasons and one check (§ 10). |
| The answer account | `answer-account/account.ts` · `accountForAnswer`; `facts/howSure.ts` · `readHowSure`; `shown.ts` · `SHOW_ME_ALLOW_LIST` | Gains one line per claim, labelled by kind (§ 7). |
| Typed negatives | `integrity/negative-claim/` (`statement.ts` · `composeStatement`, `types.ts` · `TypedNegativeRow`); design `2026-10-negative-claims.md` | The precedent for a claim the library states from rows: `about`, this leg only, `superseded-by-write`, `stale-turn`. |
| Exact-claim foundations, unmounted | `integrity/claim-binding/` (`types.ts` · `ClaimBindingRule`, `ScopeDeclaration`, `BINDING_REASONS`; `scope.ts` · `executedScope`, `scopesMatch`; `capture.ts` · `captureDispatch`, `finalizeEvidence`, `resultIdentityOf`) | Reused and changed as § 3 says. |

## 3. What V1 reuses from #109 and #195, and what it changes

**From draft PR #109 (exact scoped claim verification foundations), reused:**

- the one result identity, `capture.ts` · `resultIdentityOf` (`claim-result/<ns>/<runId>/<ordinal>`),
  reserved before dispatch, never a provider call id;
- capture at the real execute boundary with an explicit grant: `captureDispatch`,
  `captureReturnedEvidence`, `finalizeEvidence`; a receipt keeps facts, coverage and period
  only under `resultVisible`, and scope only under `scopeVisible`;
- the executed scope as a projection of the arguments `execute` received, at authored paths,
  through the author's normalizer (`scope.ts` · `executedScope`), and the exact match
  (`scopesMatch`);
- the fail-closed reason vocabulary (`BINDING_REASONS`: `missing-result`, `scope-mismatch`,
  `missing-fact`, `coverage-undeclared`, `coverage-partial`, `coverage-unknown`, …) and the
  rule that a binding is eligible comparator inputs, never a badge;
- the shared evaluator (`evaluate.ts` · `evaluateClaimPair`, `compareClaimValues`);
- bounded copies of every model-supplied or tool-supplied object (`lib/boundedJson.ts` · `copyJson`).

**Changed from #109:**

- #109 binds a literal claim the MODEL declares (`core/agent/findings/verificationCheck.ts` ·
  `checkFindingClaim` starts from the model's `_findings`). V1 binds the delivered typed field
  (#195's position); the model declares nothing new.
- #109's scope is the CALL's side only: the arguments at declared paths. V1 adds the ROW's
  side: a row must itself name its subject, field, unit and time (§ 5). A tool asked for
  node 7 that serves node 9's row does not bind.
- #109 has no unit, no per-row time, no window, no derivation, no interpretation. V1 adds
  each.
- #109's completeness is an authored callback (`ClaimBindingRule.coverage`). V1 reads the
  composed coverage row instead; no callback.

**From PR #195 (design for mounting exact claim checks), reused:**

- the position: the app declares, the runtime binds, the model never names the evidence;
- `claimScope` built on the server; the per-field rule `{ tool, fact, required, compare,
  companions }`; the comparator table (`money`, `number`, `oneOf`, `instant`, `text`), both
  ways round; companions;
- reads, writes and sends; `written-after-read`; freshness by `measured_at`; the latest
  attempt for the scope decides;
- the fail-closed table; the standing rule (every required claim supported on the delivered
  candidate is the tie check behind "known"; the short form may fail and never verifies);
- enforce's delivery table and "no automatic turn can act";
- the registered-rule bench shape (world table, planted drafts through the same harness,
  intervals clustered by case).

**Changed or extended from #195:**

1. **The subject can come from the answer.** #195 takes the subject from `claimScope` only.
   The field case has no session-bound subject: the person names a node. V1 lets the
   contract declare a SUBJECT FIELD of the typed answer, whose value must join a `resolved`
   population value of this leg's reads (§ 4). A bare string the record does not resolve
   places nothing.
2. **A window per claim.** #195 has freshness (age of `measured_at`). V1 adds the claim's
   time window, matched against the row's time and the read's declared period (§ 6).
3. **Units have a door.** #195 says units "come from the record's own row" and names no
   field. V1 names the declarations (§ 5).
4. **Calculated values.** #195 defers derived figures. V1 admits a closed set of derivations
   over bound rows (§ 7).
5. **Interpretations are a declared kind**, labelled, never verified (§ 7).
6. **Rowsets bind too.** #195 binds `describedResult` facts. V1 also binds a plain rowset
   whose tool declares a subject column (§ 5).
7. **The explanation.** #195 has `missing-fact`. V1's `subject-unplaced` and
   `subject-mismatch` carry a note saying where the value does appear ("1200 appears only
   under Customer A"), which is the probe's finding. The note explains; it never binds.
8. **No correction turn in v1.** #195 keeps the correction off by default; V1 does not build
   one. A contradiction under enforce goes to the recorded value or "I don't know", by
   #195's table.

## 4. The claim model

A claim is one typed answer field, read as `{ subject, field, unit?, window?, value }`, and
checked with the coverage of the result that binds it.

```ts
agent
  .outputSchema(NodeAnswer) // { node, cpu_pct, cpu_unit?, status }
  .claims(
    {
      cpu_pct: {
        tool: 'node_metrics', fact: 'cpu_pct', required: true,
        subject: { field: 'node' },     // † the subject field of the typed answer
        window: 'turn',                 // † the turn's confirmed window
        compare: 'number',
        derive: ['mean'],               // † derivations the field admits (§ 7)
      },
      status: { kind: 'interpretation', of: ['cpu_pct'] }, // † labelled, never verified
    },
    { tools: { node_metrics: { reads: { node: ['node'] } } } }, // #195's contract
  );
```

| Part | Comes from | Never from |
|---|---|---|
| subject | (a) `claimScope`, built on the server (#195 § 3.1), for a dimension the contract names; or (b) a declared subject field of the typed answer (`subject: { field }`†). In (b) the field's value, after the app's normalizer, must equal the `id`, the `name` or an `aliases` entry of a `resolved` population value of a read of this leg (`ComposedItem.resolved`), or the `entity` of a row that binds. Case-exact after the normalizer; no fuzzy match. | the model's prose; a spelling only the answer uses; a guess from a result's text |
| field | the contract: `fact` (an envelope fact's key, or a series `metric`) or `column`† (a declared column). Exact name. | a synonym; the answer's own key name; the model |
| unit | the result's declaration (§ 5). The answer's unit, when the contract names a unit field (`unit: { field: 'cpu_unit' }`†) or a fixed unit (`unit: '%'`†), is read only to compare. | the model's unit alone; a unit guessed from a column name |
| window | `window: 'turn'`†: the turn's confirmed window, as the time layer executed it (`time/rows.ts` · `CallWindowRow`, `executed`); or `claimScope.window`†; or `window: 'none'`† (a point claim, "as of" the row's time) | the model's prose ("over the last hour" in text binds nothing); the result's own period (that is what the window is compared AGAINST) |
| value | the typed field itself, on the delivered candidate (`readValidatedAnswer` on the candidate `candidateDigest` names, #195 § 3.3) | a literal in `_findings` (#109's shape) |
| coverage | the composed coverage row of the bound result (`ComposedCoverage`: `complete`, `gaps`, `period`), joined by `resultId` | the model; prose |

**Free prose binds nothing.** A prose answer has no contract (`.claims()` requires
`.outputSchema()`), so V1 is absent from it and nothing changes. A field of a typed answer
that the contract does not name is prose to V1: it stays under names-and-numbers, and V1
files nothing for it, no row, no reason, no label. Under a contract the account says in
words that those fields were checked for appearance in results, not for what they are about
(§ 7). An app that wants V1 on a value puts it in a declared field, or lets the library
render it from the record (#195's recorded value).

**The model points at nothing.** Typed negatives let the model cite a read by handle
(`2026-10-negative-claims.md`, § 5.1). V1 does not: the binding is total over this leg's
bound results, so a hint can only narrow wrongly, and it costs tokens (#195's clause S5-8).
Whether a handle should narrow a large binding is an open question (§ 15).

## 5. Binding in results — what a tool must declare

Two result shapes bind. A value in any other shape is `result-unbound`: it can still ground
the gate, and it can never be observed.

**(A) The envelope**, `describedResult()` → `ToolSemantics`:

- `facts[]`: `entity` is the subject; every other key is a field. A fact's time is the
  result's `provenance.measured_at` (required with facts). A fact's window is the result's
  `period.queried` when `grain.aggregation` says the value is a fold over the read; without
  one the fact is a point, "as of `measured_at`".
- `series[]`: `entity`, `metric` (the field), `t` (the time, read by `time/instant.ts` ·
  `instantOf`, lenient; a `t` without a zone is read in the zone of the result's `period`
  when it declares one, else the point has no time), `value`.
- `units`†: `{ [field]: unit }`, declared on the envelope. A field with no unit binds a
  unitless claim only.
- `resolved[]`: the entity each population value resolved to, with `aliases` for every
  spelling the tool accepts.
- `period`, `provenance`, `coverage`, as today.

**(B) A rowset**: a top-level array of plain rows (what `core/agent/emptiness.ts` ·
`readEmptiness` reads) from a tool whose `resultColumns` declares roles:

```ts
resultColumns: {
  node:    { type: 'string', role: 'subject' },        // † exactly one
  t:       { type: 'date',   role: 'time' },           // † at most one; instants with a zone
  cpu_pct: { type: 'number', unit: '%' },              // † a unit on a number column
}
```

The rows' window is the `time` column; else the period the result declared through
`coverage(rows, { period })` (`semantics/coverage/ledger.ts` · `coverage`); else
`window-undeclared`. Without a `subject` column a rowset binds nothing, whatever its keys
look like: declared, never inferred (the `argumentsFrom` precedent).

What a tool must declare, in one list:

1. the subject of every row: `entity` on a fact or series point, or the `subject` column;
2. the field of every value: the fact key, the `metric`, or the column name — the contract
   maps answer fields to these names, exactly;
3. the unit of every numeric field it wants checked with a unit: `units`† or the column's
   `unit`†, from one closed vocabulary (`FIGURE_UNITS`, a `/s` suffix, and ISO 4217 currency
   codes for `money`); an unknown unit string is kept as an opaque label compared by equality;
4. when: `t` on a series point, a `time` column, or `provenance.measured_at`; and the read's
   `period` (`{ queried, held }`) for any span claim;
5. `grain.aggregation` when a fact is a fold over the window, so a point and a span are not
   confused;
6. `resolved` for the population arguments of its `search`, with `aliases`, so the person's
   word for the subject joins the rows' ids;
7. `search`, `period` and `effects` as today, so coverage, the executed window and
   read-or-write compose.

A declaration is REFUSED at the mint, never repaired (the `periodProblem` law): a `units`
entry naming a field no row carries, a unit outside the vocabulary that is not a plain
label, two subject columns, a `time` column whose values do not parse, a `role: 'subject'`
column absent on any row. A remote (MCP) result is `result-unbound` in v1: only an envelope
minted in this process by a first-party tool, or a local tool's declared columns, binds
(#195's envelope-origin rule).

## 6. The check

Per claim, in this order, fail closed. The first failure names the reason; nothing later
can turn it into support.

1. **Read the field** from the delivered candidate. Absent, `null` or `'unknown'`: kind
   `missing`, reason `declined`. This fires nothing new; the layer-3 rows already say why the
   record is empty, and declining is honest.
2. **Place the subject** (§ 4). None: `subject-unplaced`.
3. **Collect bound rows** of this leg from results of the claim's `tool`, with the subject
   (ids and aliases, after the normalizer) and the field. None: `field-unbound` when rows of
   that subject exist without the field; `subject-mismatch` when rows of that field exist for
   other subjects only. On `subject-unplaced` and `subject-mismatch` alike, when the answer's
   value appears under another subject, the reason carries that note (the probe: "1200
   appears only under Customer A"). The note explains; it never binds.
4. **Window.** Let W be the claim's window. A point row binds when its time lies in W
   (inclusive, `compareInstants`). A fold row (an aggregation declared) binds when the
   result's `queried` equals W under the rule `periodTimeCheck` already applies (what files
   `period-differs-from-asked`). Rows outside W only: `window-outside`. No time and no period:
   `window-undeclared`. A claim with `window: 'none'` binds a point row "as of" its time and a
   fold row "over" its queried period; the label states that time.
5. **Coverage.** The result's declared `held` must cover W (`periodVerdict` = `covered`).
   `partly-held`: the rows that bind are observed within the held part only, and the label
   says so; `not-held` and `unknown`: `coverage-not-held`, `coverage-unknown`. A composed
   coverage gap bearing on the population is stated on the label and never changes the
   verdict (the typed negatives' rule: a gap is stated, not a withhold).
6. **Unit.** Let U be the field's declared unit and A the answer's. No U: only a unitless
   claim binds; A given: `unit-undeclared`. A equals U: compare. A is a declared scale of U
   (the figures dial's 1000^k / 1024^k families): compare after the scale, labelled
   calculated with `unit-scale`. Else `unit-mismatch`.
7. **Value.** `compareClaimValues`, both ways round (#195), decimals at the answer's own
   precision (`roundsTo`), text and vocabulary exactly after the declared table, instants by
   `compareInstants`. A point claim (`window: 'none'`), or a span claim with exactly one
   bound row, compares to that row: equal is **observed**, different is **contradicted**
   (`value-differs`). A span claim with several bound rows binds only through a derivation
   (step 8): a bare value equal to one of the rows is `point-in-span`, not checked, with
   that row's time stated, because a reading at one moment is not a value over the window.
   Two bound rows at one time with different values: `rows-disagree`, not checked.
8. **Derivation.** A value no bound row carries, or a span claim over several rows, on a
   field whose contract admits derivations (`derive`†): recompute each admitted derivation
   over the bound rows, in exact decimals, and compare at the answer's precision. A match:
   **calculated**, the derivation named. None, and the value equals no bound row:
   `value-differs`, **contradicted**.
9. **Superseded.** A call of a tool that is not a declared read, dispatched after the bound
   read in the same leg (a same-batch call counts as after): `superseded-by-write`, not
   checked.
10. **Leg.** Rows of an earlier leg: `stale-turn`, not checked.

Two axes come out of it. The **kind** is one of `observed`, `calculated`, `interpretation`,
`missing`. The **verdict** is `supported`, `contradicted` or `not-checked`. An observed or
calculated claim is supported; a bound claim whose value differs is contradicted; every
failure above is not-checked, and the claim's kind is `missing` with the reason.
An interpretation is never supported and never contradicted.

The failure modes, in one table:

| Reason | Fires when | The probe or case |
|---|---|---|
| `declined` | the field is absent, `null` or `'unknown'` | an honest "I don't know" |
| `subject-unplaced` | the subject field's value equals no `resolved` value and no bound row's `entity` of this leg, and `claimScope` names none; the account adds where the value does appear | Codex's probe: nothing was read about Customer B; "1200 appears only under Customer A" |
| `subject-mismatch` | a read placed the subject (it was asked for, resolved, or returned absent), and rows of the field exist for other subjects only; the same note | a read for B returned `absent()`; A's 1200 is the only balance |
| `point-in-span` | a span claim over several bound rows equals one row and no admitted derivation | node 7's own peak at 08:50, stated as "over the last hour" |
| `field-unbound` | rows of the subject exist, none carries the field | `credit_limit` served, `balance` claimed |
| `window-outside` | every row of the subject and field lies outside W | node 7's 07:30 reading for the 08:15–09:15 claim |
| `window-undeclared` | no row time and no declared period | a result with rows and no `t`, no `measured_at`, no `period` |
| `coverage-not-held`, `coverage-unknown` | the read's `held` does not reach W, or is `unknown` | a nightly export asked about the last hour |
| `unit-undeclared`, `unit-mismatch` | the answer states a unit the field does not declare, or another unit | "87 MB" over a field in GB |
| `value-differs` | one bound row, another value; or no admitted derivation reproduces the value | 87 stated; the row says 64 |
| `rows-disagree` | two bound rows at one time, two values | two reads of one store that disagree |
| `superseded-by-write` | a non-read call after the bound read, same leg | a reset after the metrics read |
| `stale-turn` | the bound read belongs to an earlier leg | an answer after a pause, from the read before it |
| `result-unbound` | the result declares neither envelope nor subject column | plain JSON from an MCP tool |

## 7. The four kinds, and how each is labelled

| Kind | When | The account's line (library-rendered, fixed templates, versioned) | The standing line | The standing |
|---|---|---|---|---|
| **observed** | bound and equal (§ 6 steps 1–7) | "Observed — `node_metrics` returned cpu_pct for node-7 at 09:10, read 09:15, covering 08:15–09:15." | nothing; under "known": "Known — N values observed in results of {who}" | counts toward the tie check behind "known" with enforce (#195 § 3.5) |
| **calculated** | a value no bound row carries that is an admitted derivation over bound rows (step 8) | "Calculated — the answer's cpu_pct is the mean of 12 readings of node-7 between 08:15 and 09:15, from `node_metrics`; the library recomputed it." | nothing | counts like observed, under the admitted derivations only (open question 3) |
| **interpretation** | a field declared `kind: 'interpretation'`† with `of: [fields]` | "Interpretation — the answer's status is the model's reading of cpu_pct (observed); the record holds no rule for it." | "'status' is the model's reading of observed values" | never supports; fires nothing when every `of` field is observed or calculated; `claim-unbound` on an `of` field that is not |
| **missing** | declined, or any not-checked reason of § 6 | "Missing — the answer states cpu_pct for node-7 over 08:15–09:15; no result of this turn carries it: `node_metrics` read 07:00–08:00 for node-7, and the value appears only under node-9." | "the record holds no value for {subject}'s {field} in the window asked" | `claim-unbound`†, not sure; `declined` fires nothing new |
| contradicted (a verdict, not a kind) | bound, value differs | "Contradicted — the answer's cpu_pct for node-7 at 09:10 differs from what `node_metrics` returned (read 09:15)." | "a value the answer states differs from what {who} returned" | `claim-contradicted` (planned in `honesty/README.md` § 4.2), not sure |

**How a calculation is checked.** The derivation set is closed: the figures dial's
`rounded`, `unit-scale`, `column-sum`, `column-ratio`, `column-difference` and `complement`
(`figures.ts` · `explainFigure`), plus `mean`†, `min`† and `max`† over the points of ONE
subject and field within W. The last three are admitted only over bound series points,
because binding pins the operand set: the library does not search for a subset of rows that
happens to average to the answer's number. Each is recomputed in exact decimals
(`numberPrecision.ts` · `decimalsOf`, the BigInt path `scientificDecimalOf` uses) and compared
at the answer's precision. The coincidence window the figures dial names (±0.5 for a whole
number) remains and is smaller here, since the operands are fixed; it is reported, not hidden.
A derivation the contract does not admit is never tried. An average over mixed subjects, a
product or a chain of two derivations is not reconstructed.

**What an interpretation is.** A word or sentence the model wrote over observed values:
"high", "healthy", "stable", "improving". The library cannot verify it and does not try. It
labels it as the model's, names the observed values it reads from, and never lets it count
toward "known". A claim field whose value is outside its declared vocabulary is not an
interpretation; it is `incomparable` (#195's table) and not checked.

**Fields the contract does not name.** Under a contract, the account's "How sure" row keeps
today's lines and adds one sentence when such fields state a value: "Values in fields the
contract does not name were checked for appearance in results, not for what they are about."
The standing is unchanged. V1 says what it did not do, in words, rather than staying silent.

## 8. Beside names-and-numbers

| | names-and-numbers | V1 |
|---|---|---|
| The question | did the value appear in a result the run read? (F3) | does a row bind it to the claimed subject, field, unit and window, with coverage? (F4) |
| Reads | every token of prose and typed answers | typed claim fields only |
| Evidence | every `role: 'tool'` message, text or JSON | bound rows of this leg: the envelope, or declared columns |
| Verdict | grounded / flagged (membership) | kind + verdict (§ 6) |
| Standing | `value-unsupported`; a clean pass never supports | `claim-unbound`, `claim-contradicted`; observed under enforce is the tie check |
| Opt-in | `.namesAndNumbersFromEvidence()` | the scoped `.claims()` contract over `.outputSchema()`, under `agentChecks: ['claims']` |

When both run:

1. **The gate runs first, as today**: on the draft at Route (`route.ts` · `judgeEvidence`),
   with its one repair turn under `guard`, and on the delivered candidate inside answer
   validation (`core/agent/stages/answerEvidence.ts`). V1 runs on the delivered candidate
   only, in the same validation, before the gate's candidate row is written.
2. **V1 never widens the gate.** A bound row is in the corpus the gate read, so an observed
   value is always grounded. Pinned by a property test (§ 12).
3. **A calculated value is handed to the gate as a computed figure.** The gate flags a mean
   no row carries. V1's calculated values for the candidate are passed to the gate's judge as
   `computed` entries (`EvidenceVerdict.computed`, `derivation: 'mean'`†, `from` naming the
   rows), so the two rows cannot disagree on one value. The draft-time verdict is unchanged
   in v1; whether V1 should also bind at the draft is open (§ 15).
4. **V1 reads nothing from prose**; the gate keeps reading prose and typed values alike.
5. **The figures dial's arithmetic keeps its own law** for prose and for non-claim numbers.
   For a claim field, V1's verdict is the one the standing reads.

## 9. The field case, end to end

The host app's tool, declared:

```ts
const nodeMetrics = defineTool({
  name: 'node_metrics', displayName: 'the node metrics read',
  inputSchema: { /* node: string, window: string */ },
  search: { source: { what: 'the metrics store', said: ['the metrics store'] },
            subject: { what: 'nodes', said: ['node', 'nodes'] },
            arguments: [{ name: 'node', role: 'population' }, { name: 'window', role: 'period', whenOmitted: '1h' }],
            complete: 'within-arguments' },
  period: { argument: 'window', spelling: 'lookback', direction: 'past', retention: '30d', granularity: '5m' },
  askOrAssume: { window: { assume: '1h' } },
  effects: 'read',
  execute: async ({ node, window }, ctx) =>
    describedResult({
      series: points,                                     // { t, entity: 'node-7', metric: 'cpu_pct', value }, every 5 minutes
      grain: { interval: '5m', aggregation: 'avg' },
      units: { cpu_pct: '%' },                            // †
      provenance: { measuredAt: lastSample, source: 'the metrics store' },
      period: { queried: executedWindow, held: storeHeld },
      resolved: [{ argument: 'node', id: 'node-7', name: 'node 7', aliases: ['nd7'] }],
    }),
});
```

The person asks "node 7 CPU over the last hour". Under `.time()` the window is confirmed as
08:15–09:15 and the call runs with it. The store returns node-7's points for two hours (the
backend's minimum) and, because the host app's store is shared, node-9's points too. The
typed answer is `{ node: 'node 7', cpu_pct: 71, status: 'high' }` under the contract of § 4.

| Step | What V1 reads | Outcome |
|---|---|---|
| subject | `node 7` equals `resolved[].name` of this leg's `node_metrics` read | placed: `node-7` |
| rows | series points with `entity: 'node-7'`, `metric: 'cpu_pct'` | 24 points; node-9's 24 points are never candidates |
| window | `t` within 08:15–09:15 | 12 points; the 07:15–08:15 points are outside |
| coverage | `period.held` covers 08:15–09:15; `complete: true`; no gap | covered |
| unit | `units.cpu_pct` is `%`; the answer states none | compare as `%` |
| value | 71 is no point's value; `derive: ['mean']` admitted; mean of the 12 points is 71.3; at the answer's precision, 71 | **calculated** |
| status | `kind: 'interpretation'`, `of: ['cpu_pct']`, which is calculated | **interpretation**, fires nothing |

Standing: known, under enforce, if `cpu_pct` is the only required claim and the app's checks
pass; the line adds "'status' is the model's reading of observed values". The account prints
the calculated line and the interpretation line of § 7.

The same question with other drafts:

| The answer's cpu_pct | Where it came from | V1 |
|---|---|---|
| 87 | node-9's point at 07:40 | node-7 rows exist in W, so the claim binds; 87 is no node-7 point and no admitted derivation gives it: **contradicted**, `value-differs`. The account adds: "87 appears only under node-9." |
| 87 | node-7's own peak at 08:50, with `derive: ['mean']` only | one bound row equals it, the claim is over the window: `point-in-span`, kind **missing**, not checked: "the value is one reading at 08:50, not a value over the window". With `derive: ['mean', 'max']`: **calculated**, `max`. |
| 64 | node-7's point at 07:30 | 12 bound points in W, none is 64, the mean is not 64: **contradicted**. The account adds: "64 appears for node-7 only at 07:30, outside the window." |
| 71, and the store held only 08:40 onward | a partly-held read | `partly-held`: the mean is over the 7 points held; **calculated**, labelled "within 08:40–09:15 only"; `period-partly-held` fires as today |
| 71, from a read of a tool that declares no `units` and no `entity` | a plain JSON result | `result-unbound`: kind **missing**; the gate still grounds `71` only if some result spells it |
| `null` | the model declined | **missing**, `declined`; nothing new fires |

Codex's probe runs the same way with facts instead of series: the contract declares
`owes: { tool: 'get_balance', fact: 'balance', subject: { field: 'customer' } }`; the answer
says `{ customer: 'B', owes: 1200 }`; the one read of this leg resolved `A`, and its only
`balance` row has `entity: 'A'`. Nothing was read about B: `subject-unplaced`, with the note
"1200 appears only under Customer A"; kind missing, standing not sure. Had the model also
read B and received `absent()`, B is placed and the reason is `subject-mismatch`, with the
same note. The gate grounds `1200` in both runs, as it did in the probe.

## 10. The record, the standing, the account

- **One committed row per claim per judged candidate**, `claim-binding`†, on
  `findingsLedger` through the one writer (`core/agent/findings/ledger.ts` · `appendRows`):
  `turn`, `candidateDigest`, `answerField`, `kind`, `verdict`, `reason?`, `subject` (the
  resolved id, as `coverageDeclared` rows already carry it), `field`, `unit?`, `window?`
  (two instants), the bound result's `resultId`, `toolCallId` and `toolName`, `derivation?`,
  `rowsRead`, and the rule version. Never a value from the answer or a row: values stay on
  the receipt (#109's `ResultEvidence.facts`, under the app's grant) and are kept out by name
  like everything else.
- **One report row per claim** (`AnswerCheck`, id `agent:claims:<field>`, through
  `claimChecksOf`): supported → `checked-pass`, contradicted → `checked-fail`, not-checked →
  `unreachable`, declined → `not-applicable`. This is the one law V1 changes, and it is the
  change #195 already rules: an agent row is `checked-pass` only for the scoped contract's
  observed and calculated claims (`validate.ts` refuses a pass from any other agent row). The
  short form stays as it is.
- **Reasons** in `REASONS`: `claim-unbound`† (layer 4, class not-sure, rests on `answer`: the
  answer states a value the record cannot bind) and `claim-contradicted` (layer 4, not-sure,
  rests on `calls`: the bound row's call). Not-checked rows fire `check-unreachable`, as
  every armed check that reaches no verdict does. `checked` gains `claim-binding`† (layer 4):
  `of` = the claim fields that state a value, `ran` = those with a verdict.
- **The line** (`compose.ts` · `standingLineOf`) names a reason's calls by `displayName` only
  (H4). New clauses: the two of § 7, in `NAMED_REASON_WORDS` with their unnamed forms.
- **The account**: one line per claim field under "It found" (`RowId` `found`), labelled by
  kind, vouched by the weakest truth-deciding input: observed and contradicted by
  `tool:<name>` (the row) and the library (the match); calculated by the library;
  interpretation by the model; missing by the library. "How sure" counts them beside the
  reasons. The bound row's leaf joins the show-me allow-list as a derived
  `{ value, unit, t, at }`†, so "show me" reaches the row without a tool result's bytes.
- **No new event in v1.** The report and the row carry the verdict; the fold never reads
  events. An observability event (`agentfootprint.answer.claim_bound`†, identities and kinds
  only) is an open question.
- **Checkpoints.** Rows ride `findingsLedger` as every row does. Binding is per leg: a read
  before a pause cited after it is `stale-turn`, as typed negatives rule. Receipts across a
  pause are #109's carrier, mounted with the build.
- **Redaction.** Subject ids, field names and tool names are names; a policy that selects a
  state key keeps its values out, and the account says "kept out", never "no value".
- **Bounds** (proposals): 32 claims per contract; 10,000 rows read per claim and 10,000
  points per derivation, then `unreachable` with the count; 256 characters per subject
  spelling; every copied object through `copyJson` with its limit.

## 11. Threat model

| Input | Trust | It cannot |
|---|---|---|
| The model's draft and its typed fields | untrusted | choose the evidence, the row, the subject or the window; pass by naming a subject the record did not resolve; make a value observed by writing it twice |
| **A value from the wrong subject or window** | — | bind: the row must name the claim's subject and lie in its window; the value's appearance elsewhere is the explanation, never support (§ 6 steps 3–4) |
| **Unit confusion** | — | bind silently: no unit on the field admits a unitless claim only; a unit the answer states must equal the declared one or be a declared scale; a conversion is labelled calculated |
| **A subject alias** | the tool's `resolved[].aliases` and the app's normalizer are the trusted base | be invented by the model: a spelling neither declares places nothing (`subject-unplaced`). The cost is over-abstention on spellings the app forgot; it is counted (§ 13), and the fix is a declaration, never a looser match |
| **Partial coverage** | the read's declared `held` and composed gaps | be hidden: a partly-held window is labelled within the held part, and the period reason fires; `unknown` and `not-held` never observe |
| **A model inventing a binding** | — | happen: the model declares no binding. Its only levers are the subject field and the value, both checked against rows. A `restsOn`-style hint is not read in v1 |
| **A tool declaring a binding it cannot honour** (a `%` unit over fractions; a subject column holding display names; a `measured_at` over cached data) | the trusted base, as every declaration is | be caught by V1 in general: the check vouches for agreement with the tool, not for truth. What can be checked is refused at the mint (§ 5); the `check:semantics` gate judges sample results; declarations carry versions on the row; the bench scores a misreporting tool apart (§ 13) |
| Tool text, and instructions inside it | untrusted | add a row; sway a value into support: a swayed value is checked like any other |
| A result passed through from another process (an MCP structured result, an HTTP body carrying `af_semantics: true`) | untrusted | bind: `result-unbound` in v1 (#195's envelope-origin rule) |
| Two reads of one subject that disagree | — | let the model pick: `rows-disagree`, not checked |
| A write after the bound read | — | hide behind the read: `superseded-by-write` |
| A saved checkpoint | shape-checked only | revive a binding from another leg: `stale-turn` |
| The app's contract, normalizers, `claimScope`; each first-party tool's declarations and minted envelopes | the trusted base | — |

**Fail closed.** Any error, limit, timeout, unparseable time, missing declaration or ambiguity
is not-checked, never supported. A supported claim is always a row the record holds.

## 12. Test plan

Scripted, mock provider, no paid call:

- **Codex's probe**: `{ customer: 'A', balance: 1200 }` served; `{ customer: 'B', owes: 1200 }`
  answered → `subject-unplaced`, kind missing, the account's "appears only under A" note,
  the standing not sure, the gate still grounded. The variant where a read for B returned
  `absent()` → `subject-mismatch`, the same note. And the control:
  `{ customer: 'A', owes: 1200 }` → observed, supported.
- **The CPU case**, each row of the § 9 tables: calculated 71; contradicted 87 (node-9) and 64
  (07:30); `point-in-span` for node 7's own peak, and `max` when admitted; partly-held;
  `result-unbound`; declined; the interpretation label; node-9's points never candidates.
- **Every reason of § 6**, one test each, including `rows-disagree` from two reads,
  `superseded-by-write` from a same-batch non-read call, `stale-turn` across a pause.
- **Units**: no unit declared; equal; a declared scale (GB stated over a TB field, labelled
  `unit-scale`); a mismatch; an opaque label compared by equality; ISO 4217 for `money`.
- **Windows**: inclusive bounds; a point exactly on the edge; a `t` without a zone read in the
  result's period zone, and refused without one; a fold row against an equal, wider and
  narrower `queried`; `window: 'none'`.
- **Derivations**: `mean`, `min`, `max` over bound points only; an unadmitted derivation never
  tried; the precision window at whole and one-decimal precision; exact decimals (no float
  slack), pinned against an independent oracle like the scientific-notation property test.
- **Subject**: id, name and alias; the normalizer; case; a spelling nobody declared →
  `subject-unplaced`; `claimScope` beside a subject field; a subject field the answer leaves
  out.
- **Declarations refused at the mint**: a `units` field no row carries; two subject columns; a
  time column that does not parse; a unit outside the vocabulary.
- **Properties**: an observed value is grounded by the gate (never widened); adding a result
  never turns a not-checked or contradicted claim into supported except through a row that
  binds it (monotone in the #197 sense); the in-run rows equal the read-after fold
  (`assessAnswer` over the recording, the equality law).
- **Both checks together**: a calculated mean is `computed` for the gate, not flagged; a
  gate-flagged value is never observed; prose beside a typed answer gets the "appearance
  only" sentence and no row.
- **The account and the line**: goldens for the four kinds and the contradiction; the line's
  named and unnamed clauses; `displayName` used, the registered name never.
- **Byte identity**: an agent without the scoped contract is byte-identical, every reference
  under `test/core/tools/reference/` unchanged; the short form of `.claims()` unchanged.
- **Mutation tests**: each failure reason has at least one mutant that makes the check
  supported, and the suite catches it.

## 13. Measurement plan

The question is two-sided: does V1 catch wrong bindings, and does it stay quiet on correct
answers? The first side is deterministic and is proven by the scripted tests. The second
needs natural answers.

**Registered rule `binding-rule-v1`**† (`bench/binding/RULE.md`†, written before any paid
call, on the figures bench's pattern — `bench/figures/RULE.md`):

- **Model**: Haiku 4.5 only, through the package's own adapter; the answer bench's protocol.
- **Tasks**: two typed-answer tasks. (1) The node task of § 9 over a fixture store with
  several nodes and several hours; (2) the customer balance task of the probe over a fixture
  with several customers. Each fixture holds a world table, read by the tools and by a
  deterministic fixture reader that labels every stated claim true or false with its own
  comparison code.
- **Cases**: controls (the person names one subject; the answer should be observed or
  calculated); provoking (a shared store that returns neighbouring subjects and extra hours;
  a store that returns a fraction under a `%` field; an alias spelling; a partly-held read;
  a question that invites an average); fail-closed (no alias declared; a read that declares
  no time; a remote tool); a misreporting tool (the world says 64, the tool serves 87),
  scored apart.
- **Planted drafts**: on every control and provoking case, 3 extra runs swap the model's final
  draft for a planted wrong one after the real tool turns: the neighbour's value, the value
  from the hour before, the value in the wrong unit, a value no row carries. At least 20
  planted drafts reach the checker, else NOT-MEASURABLE.
- **Pass bar**: false `supported` 0 (a planted or natural false claim labelled observed or
  calculated); false `contradicted` 0 (a true claim contradicted); needless not-sure on
  natural true answers (`claim-unbound` or `check-unreachable` on a true claim) ≤ 0.10 over
  ≥ 40 answers, with `subject-unplaced`, `window-undeclared` and `unit-undeclared` counted
  apart as declaration gaps; the gate's verdict on observed values grounded 100%; model calls
  per run equal to the unarmed agent (V1 adds no turn); in-run rows equal the read-after fold
  100%.
- **Reported**: per case, with intervals that treat the case as the unit; the reason mix; the
  misreport case apart; the declaration gaps, since they say what an app must declare before
  V1 is quiet.
- **What a pass licenses**: shipping the scoped contract opt-in for typed direct facts and
  admitted derivations, on Haiku 4.5, single turn. Nothing about prose, other models or
  follow-up turns.
- **Cost**: about 160 runs; estimate under $1; cap `--max-usd 1.50`. Waits for the owner's
  budget go.

The figures bench's known limitation ("whichever pool the person asked about") becomes a
zero-cost replay here: its fixture's pool rows, with a subject column declared, must bind the
asked pool only.

## 14. Not in this design

- Prose claims. Prose binds nothing; an app moves a claim into a typed field.
- A correction turn (#195 § 7.4 keeps it off; v1 builds none).
- A model-cited handle (`restsOn`) narrowing the binding.
- Remote (MCP) results binding; a foreign envelope settles nothing in v1.
- Derivations beyond the closed set; averages over mixed subjects; chains.
- An app-supplied rule for an interpretation (`given` provenance over a model word): a
  later design.
- Binding across legs or turns; receipts carried through `continueFrom`.
- Changes to the gate, the corpus, the exempt corpus or the figures dial's own arithmetic.
- The time layer's `current` shape (`2026-10-time-interpretation.md`, § 8.1) is not built; a
  claim about "right now" binds as a point "as of" the row's time, nothing more.

## 15. Open questions, with proposed answers

1. **Does a calculated value count toward "known"?** Proposed: yes, under the admitted
   derivations only, because the operands are observed rows and the arithmetic is the
   library's. The figures dial's `computed` never counts, and still does not.
2. **Does an interpretation field with a value cap the standing?** Proposed: no. The
   standing is about the recorded facts; the line names the field as the model's reading.
   An app that wants no interpretation declares none, and a word in a claim field is then
   `incomparable`.
3. **Which derivations in v1?** Proposed: the figures set plus `mean`, `min`, `max` over bound
   points. `median`, `p95` and `sum` over points wait for a case.
4. **Should V1 also bind at the draft**, so the guard's repair turn does not ask the model to
   replace a correct mean? Proposed: not in v1; the calculated value is handed to the gate at
   the candidate, and the draft-time repair stays the figures dial's concern.
5. **A `restsOn` hint**, as typed negatives use? Proposed: no, until a bound shows the total
   binding too costly.
6. **A new event?** Proposed: none; the row and the report carry the verdict.
7. **Remote results.** Proposed: `result-unbound` in v1; a later design can let the app
   register a remote tool's columns locally, with the envelope-origin question answered.
8. **The unit vocabulary.** Proposed: `FIGURE_UNITS`, `/s`, ISO 4217, and opaque labels by
   equality. Temperatures, counts and durations wait for a case.
9. **Where `units`† lives.** Proposed: on the envelope and on the column, one vocabulary; a
   tool-level `Tool.units`† is refused when it disagrees with an envelope.

## 16. Decisions

1. V1 checks a typed claim field with its subject, field, unit, window and coverage. Prose
   binds nothing, and the record says so.
2. The app declares which fields are claims and what settles each; the tool declares what its
   rows are about; the library binds. The model declares nothing and names no evidence.
3. Two result shapes bind: the envelope (`facts` with `entity`, `series` with `entity`,
   `metric`, `t`) and a rowset with a declared subject column. Units are declared on the
   envelope (`units`†) or the column (`unit`†). Anything else is `result-unbound`.
4. The subject comes from `claimScope` or a declared subject field joined to this leg's
   `resolved` values and aliases, after the app's normalizer. No fuzzy match.
5. The window is the turn's confirmed window or `claimScope`'s; a point row binds inside it,
   a fold row binds when the read's queried period equals it; coverage is the read's declared
   `held` and composed gaps.
6. Four kinds: observed, calculated, interpretation, missing. Three verdicts: supported,
   contradicted, not-checked. Every failure is named and fails closed.
7. Calculations are a closed set over bound rows, recomputed in exact decimals at the
   answer's precision, and only where the contract admits them.
8. V1 runs on the delivered candidate inside answer validation. The gate runs first and is
   never widened; V1's calculated values reach the gate as computed figures.
9. Two reasons (`claim-unbound`†, `claim-contradicted`), one check (`claim-binding`†), one row
   per claim, one line per claim in the account, no new event.
10. Reused from #109: identity, capture with grants, executed scope, reasons, the evaluator.
    Reused from #195: the position, the contract, comparators, freshness, the delivery table,
    the bench shape. Changed: the subject may come from the answer; a window per claim; a unit
    door; the row side of binding; calculated and interpretation kinds; no correction turn.
11. Measured before it ships: zero false supported, zero false contradicted, needless not-sure
    ≤ 0.10 on natural true answers, declaration gaps counted apart.
