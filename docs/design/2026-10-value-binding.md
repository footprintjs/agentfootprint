# Value binding (V1) — a value counts only with its subject, field, unit, window and coverage

**Design for review. Not approved to implement.** Nothing in this page is built. Written
2026-10-29 from the revised V1 requirement. The owner approved starting the design; the
owner and Codex review it through the review exchange, and the build follows in its own PR
after that review. Revised the same day after Codex's review of the first draft (five
findings, all adopted): a claim now declares its operation, and fold compatibility is checked
before any equality; one point never proves a span claim, whatever the row count; a
calculation over a narrower window never verifies the wider claim; the check is one control
flow that tells contradiction apart from inability to check; the inherited scope, latest-read
and freshness safeguards are steps of that flow; a window carries the executed range's
boundary convention; the whole answer never gets an unqualified "known" beside a model
interpretation; and the measurement claims only what the registered cases test.

Code is cited as `file` · `symbol`, under `src/`. A name marked † does not exist yet: it is
this page's proposal, and the build may rename it. Examples use neutral subjects (customers,
nodes); "the host app" names the app the field report came from.

## For the owner

- The names-and-numbers gate proves a value APPEARED in a result. It cannot prove the value
  BELONGS to the subject the answer names. Codex's probe: a result said "Customer A: balance
  1200" and the gate accepted "Customer B owes 1200". The field case: a CPU reading from
  another node, or another hour, counted as support for "node X's CPU in the last hour".
- V1 checks a value together with its subject, field, unit, time window and coverage, under
  the OPERATION the claim declares (a point value, or a mean, minimum or maximum over the
  window). It works only on claims the record can read without guessing: a typed answer field
  the app declares as a claim, bound to rows of a result that declares what each value is
  about. Free prose stays under the membership check.
- Every statement the check can place is labelled one of four kinds: **observed** (a row
  carries it, under the claimed operation), **calculated** (the library recomputed the
  declared operation from a complete set of observed rows), **interpretation** (the model's
  reading of observed values), **missing** (the record holds no value for it). A bound value
  that disagrees with its complete operands is **contradicted**.
- Three rules keep it honest: one reading at one moment never proves a claim about an hour;
  a calculation over the part the store held never verifies the claim about the whole
  window; and a maximum never supports a claim that says "average", because the operation
  is declared and checked before any number is compared.
- An answer that carries a model interpretation, or any field the contract does not name,
  is never "known" as a whole: the checked fields keep their labels, and the standing says
  "consistent with the record" at most, naming the field.
- V1 is opt-in and stronger than names-and-numbers. Both run; neither widens the other.
- The model's honesty is not assumed anywhere. The app declares which fields are claims and
  what settles each; the tool declares what its rows are about; the library binds. The model
  never names the evidence.
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
field, unit and window the claim is about, under the operation it declares, with the
coverage of the read that returned it.

## 2. What exists, and what this design builds on

| Piece | Where | What V1 does with it |
|---|---|---|
| The gate | `core/agent/evidence/gate.ts` · `checkAnswer`; the corpus `evidenceIndex.ts` · `evidenceFromHistory`; the carriers `EvidenceCorpus.carriers`, `answerCarriers.ts` · `answerCarriersOf` (`evidence_checked.carriedBy`) | Unchanged. V1 never widens it (§ 8). |
| A typed answer, read value by value | `extract.ts` · `readAnswer`, `answerTexts`; the Route judge `core/agent/stages/route.ts` · `readValidatedAnswer` | The claim side: V1 reads the typed field itself. The reader gains the JSON path of each literal (§ 8). |
| The claim contract | `core/agent/AgentBuilder.ts` · `claims()`; `integrity/unsupported-claim/check.ts` · `compareClaim`, `DeclaredClaim`, `ClaimLedgerRow`; `delivered.ts` · `judgeDeliveredClaim`; `evaluate.ts` · `evaluateClaimPair`, `compareClaimValues` | Extended with the scoped form of #195 and V1's parts (§ 4). The short form keeps #195's ruling: it may fail, it never verifies. |
| Answer validation and the agent's own rows | `answer-validation/validate.ts` · `executeAnswerValidation`; `agentChecks.ts` · `claimChecksOf`, `evidenceCheckOf`, `AGENT_CHECK_PREFIX`; the stage `core/agent/stages/answerValidation.ts` · `withAnswerValidation`; `agentChecks: ['claims']` (#197) | The seam V1 runs at: the delivered candidate. |
| The semantic envelope | `semantics/described.ts` · `describedResult`; `semantics/types.ts` · `ToolSemantics`, `SemanticFact` (`entity` required), `SemanticSeriesPoint` (`t`, `entity`, `metric`, `value`), `SemanticGrain` (`interval`, `aggregation`, `is_counter`, `collapsed`), `SemanticProvenance` (`measured_at`, `source`) | The first result shape that binds (§ 5). It already says what each row is about, and how each value was folded. |
| Resolved population values | `semantics/coverage/search/resultFacts.ts` · `ResolvedDeclaration` (`argument`, `id`, `name`, `aliases`); on the composed row `semantics/coverage/composedCoverage.ts` · `ComposedItem.resolved` | How the person's subject word is joined to a row's subject (§ 4). |
| Composed coverage and result identity | `composedCoverage.ts` · `ComposedCoverage` (`resultId`, `handle`, `complete`, `gaps`, `period`); `Tool.search` (`semantics/coverage/search/types.ts` · `ToolSearch`, `SearchRole`) | The coverage a bound value inherits, and the one result identity (never a provider call id). |
| The period a read covered | `semantics/coverage/period.ts` · `DeclaredPeriod`, `periodVerdict`, `PeriodRow`; the results layer `core/agent/results/subflow.ts`; under `.time()` `time/check.ts` · `periodTimeCheck` | The coverage rule (§ 6). V1 adds no second period law. |
| The executed window and its edges | `time/rows.ts` · `CallWindowRow` (`asked`, `sent`); `time/range.ts` · `TimeRange`, `InclusiveSpan`; `time/periodForm.ts` · `Bound`, `ToBound`, `Edge` (a `to` bound declares its edge, never defaulted) | The window and its boundary convention (§ 6). |
| Declared columns | `tools/tools.ts` · `DefineToolOptions.resultColumns`; `integrity/column-types/types.ts` · `ToolResultColumns`, `ColumnDeclaration`, `ColumnType` | The second result shape that binds, once columns carry a role and a unit (§ 5). |
| Units and precision | `core/agent/evidence/figureUnits.ts` · `FIGURE_UNITS`; `numberPrecision.ts` · `roundsTo`, `decimalsOf`, `scientificDecimalOf`; `figures.ts` · `explainFigure` | The unit vocabulary and the one rounding rule; the `unit-scale` families. The figures dial's own arithmetic is not admitted for claims (§ 7). |
| Instants | `time/instant.ts` · `instantOf`, `compareInstants` | Every time comparison. |
| The standing | `core/agent/assessment/assess.ts` · `assessAnswer`; `reasons.ts` · `REASONS`; `sources.ts` · `reasonSourceOf`; `compose.ts` · `standingLineOf` | Gains two reasons, one check and a stricter tie check (§ 10). |
| The answer account | `answer-account/account.ts` · `accountForAnswer`; `facts/howSure.ts` · `readHowSure`; `shown.ts` · `SHOW_ME_ALLOW_LIST` | Gains one line per claim, labelled by kind (§ 7). |
| Typed negatives | `integrity/negative-claim/` (`statement.ts` · `composeStatement`, `composeRecordedStatement`; `types.ts` · `TypedNegativeRow`); design `2026-10-negative-claims.md` | The precedent for a claim the library states from rows: `about`, this leg only, `superseded-by-write`, `stale-turn`, and a library-written statement with its own scope. |
| Exact-claim foundations, unmounted | `integrity/claim-binding/` (`types.ts` · `ClaimBindingRule`, `ScopeDeclaration`, `BINDING_REASONS`; `scope.ts` · `executedScope`, `scopesMatch`; `capture.ts` · `captureDispatch`, `finalizeEvidence`, `resultIdentityOf`) | Reused and changed as § 3 says. |

## 3. What V1 reuses from #109 and #195, and what it changes

**From draft PR #109 (exact scoped claim verification foundations), reused:**

- the one result identity, `capture.ts` · `resultIdentityOf` (`claim-result/<ns>/<runId>/<ordinal>`),
  reserved before dispatch, never a provider call id;
- capture at the real execute boundary with an explicit grant: `captureDispatch`,
  `captureReturnedEvidence`, `finalizeEvidence`; a receipt keeps facts, coverage and period
  only under `resultVisible`, and scope only under `scopeVisible`;
- the executed scope as a projection of the arguments `execute` received, at authored paths,
  through the author's normalizer (`scope.ts` · `executedScope`), and the exact match on the
  complete scoped identity (`scopesMatch`);
- the fail-closed reason vocabulary (`BINDING_REASONS`: `missing-result`, `ambiguous-result`,
  `scope-mismatch`, `missing-fact`, `coverage-undeclared`, `coverage-partial`,
  `coverage-unknown`, …) and the rule that a binding is eligible comparator inputs, never a
  badge;
- the shared evaluator (`evaluate.ts` · `evaluateClaimPair`, `compareClaimValues`);
- bounded copies of every model-supplied or tool-supplied object (`lib/boundedJson.ts` · `copyJson`).

**Changed from #109:**

- #109 binds a literal claim the MODEL declares (`core/agent/findings/verificationCheck.ts` ·
  `checkFindingClaim` starts from the model's `_findings`). V1 binds the delivered typed field
  (#195's position); the model declares nothing new.
- #109's scope is the CALL's side only: the arguments at declared paths. V1 adds the ROW's
  side: a row must itself name its subject, field, unit and time, and how its value was
  folded (§ 5). A tool asked for node 7 that serves node 9's row does not bind.
- #109 has no unit, no per-row time, no window, no operation, no interpretation. V1 adds
  each. The claim's OPERATION is V1's: a point value, or a mean, minimum or maximum over the
  window, declared on the claim and checked for compatibility before any number is compared.
- #109's completeness is an authored callback (`ClaimBindingRule.coverage`). V1 reads the
  composed coverage row and the declared period instead; no callback.

**From PR #195 (design for mounting exact claim checks), reused:**

- the position: the app declares, the runtime binds, the model never names the evidence;
- `claimScope` built on the server; the per-field rule `{ tool, fact, required, compare,
  companions }`; the comparator table (`money`, `number`, `oneOf`, `instant`, `text`), both
  ways round; companions;
- reads, writes and sends; `written-after-read`; freshness by `measured_at` at the delivery
  decision; the latest attempt for the scope decides, failures included, and an older success
  is never reused;
- the fail-closed table; the standing rule (every required claim supported on the delivered
  candidate is the tie check behind "known"; the short form may fail and never verifies);
  "no unverified displayed fact" (`unchecked-field`);
- enforce's delivery table, the recorded value, and "no automatic turn can act";
- the registered-rule bench shape (world table, planted drafts through the same harness,
  intervals clustered by case).

**Changed or extended from #195:**

1. **The subject can come from the answer.** #195 takes the subject from `claimScope` only.
   The field case has no session-bound subject: the person names a node. V1 lets the
   contract declare SUBJECT FIELDS of the typed answer, whose values must join a `resolved`
   population value of this leg's reads, and the subject is always the COMPLETE scoped
   identity the tool's `reads` declares (§ 4). A bare string the record does not resolve
   places nothing; a name two scopes resolved is ambiguous, not a match.
2. **A window and an operation per claim.** #195 has freshness (age of `measured_at`). V1
   adds the claim's time window and the operation over it, matched against the rows' times,
   the rows' declared fold and the read's declared period (§ 6).
3. **Units have a door.** #195 says units "come from the record's own row" and names no
   field. V1 names the declarations (§ 5).
4. **Calculated values, narrowly.** #195 defers derived figures. V1 admits three operations
   the library can recompute over a COMPLETE operand set of one subject and field (`mean`,
   `min`, `max`), and defers every multi-column operation (sums, ratios, differences,
   complements) to a later design (§ 7).
5. **Interpretations are a declared kind**, labelled, never verified, and an answer that
   carries one is never "known" as a whole (§ 7).
6. **Rowsets bind too.** #195 binds `describedResult` facts. V1 also binds a plain rowset
   whose tool declares a subject column (§ 5).
7. **The explanation.** #195 has `missing-fact`. V1's `subject-unplaced` and
   `subject-mismatch` carry a note saying where the value does appear ("1200 appears only
   under Customer A"), which is the probe's finding. The note explains; it never binds.
8. **A narrower statement is the library's own claim.** When the store held only part of the
   window, #195's recorded value is reused as a statement with ITS OWN scope (the held part)
   and verdict; it never supports the model's claim about the whole window (§ 7).
9. **No correction turn in v1.** #195 keeps the correction off by default; V1 does not build
   one. A contradiction under enforce goes to the recorded value or "I don't know", by
   #195's table.

## 4. The claim model

A claim is one typed answer field, read as `{ subject, field, operation, unit?, window?,
value }`, and checked with the coverage of the result that binds it.

```ts
agent
  .outputSchema(NodeAnswer) // { node, cpu_pct, cpu_peak, status }
  .claims(
    {
      cpu_pct: {
        tool: 'node_metrics', fact: 'cpu_pct', required: true,
        subject: { fields: { node: 'node' } }, // † the subject fields of the typed answer, per scope dimension
        window: 'turn',                         // † the turn's confirmed window
        operation: 'mean',                      // † the statistic the field claims over the window
        compare: 'number',
      },
      cpu_peak: {
        tool: 'node_metrics', fact: 'cpu_pct',
        subject: { fields: { node: 'node' } }, window: 'turn',
        operation: 'max',                       // † a different claim: the same field, another operation
        compare: 'number',
      },
      status: { kind: 'interpretation', of: ['cpu_pct', 'cpu_peak'] }, // † labelled, never verified
    },
    { tools: { node_metrics: { reads: { cluster: ['cluster'], node: ['node'] } } } }, // #195's contract
  );
```

| Part | Comes from | Never from |
|---|---|---|
| subject | the COMPLETE scoped identity of the claim's tool, one value per dimension the contract's `reads` declares (`cluster`, `node`): each from `claimScope`, built on the server (#195 § 3.1), or from a declared subject field (`subject.fields`†) whose value, after the app's normalizer, equals the `id`, the `name` or an `aliases` entry of a `resolved` population value of a read of this leg (`ComposedItem.resolved`). A dimension the claim does not supply is filled only when every read of this leg that matches the supplied dimensions agrees on it. Case-exact after the normalizer; no fuzzy match. | the model's prose; a spelling only the answer uses; a guess from a result's text; a dimension two reads disagree on |
| field | the contract: `fact` (an envelope fact's key, or a series `metric`) or `column`† (a declared column). Exact name. | a synonym; the answer's own key name; the model |
| operation | the contract: `operation`†, one of `value` (a point), `mean`, `min`, `max`. A claim with a window must declare `mean`, `min` or `max`; a point claim is `value`. Refused at build otherwise. | the model; a guess from which operation reproduces the number |
| unit | the result's declaration (§ 5). The answer's unit, when the contract names a unit field (`unit: { field }`†) or a fixed unit (`unit: '%'`†), is read only to compare. | the model's unit alone; a unit guessed from a column name |
| window | `window: 'turn'`†: the turn's confirmed window as the time layer executed it (`CallWindowRow`, `asked` or `sent`), with the executed range's boundary convention; or `claimScope.window`†; or `window: 'none'`† (a point claim, "as of" the row's time) | the model's prose ("over the last hour" in text binds nothing); the result's own period (that is what the window is compared AGAINST) |
| value | the typed field itself, on the delivered candidate (`readValidatedAnswer` on the candidate `candidateDigest` names, #195 § 3.3) | a literal in `_findings` (#109's shape) |
| coverage | the composed coverage row of the bound result (`ComposedCoverage`: `complete`, `gaps`, `period`), joined by `resultId` | the model; prose |

**Free prose binds nothing.** A prose answer has no contract (`.claims()` requires
`.outputSchema()`), so V1 is absent from it and nothing changes. A field of a typed answer
that the contract does not name is #195's `unchecked-field`: not checked, so the answer is
never "known" as a whole, and under enforce it is withheld. V1 files nothing for such a
field's VALUE: no binding, no label. The names-and-numbers gate keeps reading it. An app
that wants V1 on a value puts it in a declared field, or lets the library render it from the
record (#195's recorded value).

**The model points at nothing.** Typed negatives let the model cite a read by handle
(`2026-10-negative-claims.md`, § 5.1). V1 does not: the binding is total over this leg's
eligible results, so a hint can only narrow wrongly, and it costs tokens (#195's clause
S5-8). Whether a handle should narrow a large binding is an open question (§ 15).

## 5. Binding in results — what a tool must declare

Two result shapes bind. A value in any other shape is `result-unbound`: it can still ground
the gate, and it can never be observed.

**(A) The envelope**, `describedResult()` → `ToolSemantics`:

- `facts[]`: `entity` is the subject; every other key is a field. A fact's time is the
  result's `provenance.measured_at` (required with facts). A fact's window is the result's
  `period.queried` when `grain.aggregation` says the value is a fold over the read; without
  one the fact is a point, "as of `measured_at`".
- `series[]`: `entity`, `metric` (the field), `t` (the time, read by `time/instant.ts` ·
  `instantOf`, lenient; a `t` without an offset is read with the offset of the result's
  `period` when it declares one, else the point has no time), `value`. With
  `grain.aggregation`, each point is a fold over one `grain.interval` ending or starting at
  `t` as the tool declares (`grain.interval` and `grain.aggregation` are both required for any
  computed operation, § 6).
- `grain.collapsed` names the population a fold was taken over ("per-node rows collapsed to
  per-cluster"); such a row's `entity` is that population, and it binds only a claim whose
  subject is that population.
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
  t:       { type: 'date',   role: 'time' },           // † at most one; instants with an offset
  cpu_pct: { type: 'number', unit: '%' },              // † a unit on a number column
}
```

A rowset carries no `grain`, so it binds point claims only; a span claim over a rowset is
`grain-undeclared`. The rows' window is the `time` column; else the period the result
declared through `coverage(rows, { period })` (`semantics/coverage/ledger.ts` · `coverage`);
else `window-undeclared`. Without a `subject` column a rowset binds nothing, whatever its keys
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
5. how each value was folded, for any span claim: `grain.aggregation` (`avg`, `max`, `min`,
   `sum`, `count`, …) and `grain.interval`, and `is_counter` when the aggregation is
   counter-looking;
6. `resolved` for the population arguments of its `search`, with `aliases`, so the person's
   word for the subject joins the rows' ids;
7. `search`, `period` (with each `to` bound's `edge`) and `effects` as today, so coverage,
   the executed window and read-or-write compose.

A declaration is REFUSED at the mint, never repaired (the `periodProblem` law): a `units`
entry naming a field no row carries, a unit outside the vocabulary that is not a plain
label, two subject columns, a `time` column whose values do not parse, a `role: 'subject'`
column absent on any row, a `grain.aggregation` with no `grain.interval`. A remote (MCP)
result is `result-unbound` in v1: only an envelope minted in this process by a first-party
tool, or a local tool's declared columns, binds (#195's envelope-origin rule). Local
provenance establishes where a row came from; it does not establish that the tool told the
truth (§ 11).

## 6. The check

One control flow per claim, in three parts. Part A establishes the eligible inputs; part B
establishes the operand set the claimed operation needs; part C performs the one allowed
comparison or calculation. Every failure in A or B is **not-checked** (the claim's kind is
`missing`, with the reason). A **contradiction** can arise only in C, from complete operands
under the declared operation. Nothing in B or C can turn an A failure into support, and no
operation is ever chosen because it happens to reproduce the answer's number.

**A. Eligible inputs**

1. **Read the field** from the delivered candidate. Absent, `null` or `'unknown'`: reason
   `declined`. This fires nothing new; the layer-3 rows already say why the record is empty,
   and declining is honest.
2. **Take the operation and the window** from the contract (validated at build: a span claim
   declares `mean`, `min` or `max`; a point claim is `value`). The window W is the executed
   range of the turn's confirmed window, with its boundary convention: the `from` edge is
   inclusive; the `to` edge is what the tool's `period` form declares for the argument that
   set it (`time/periodForm.ts` · `ToBound.edge`, never defaulted); a lookback's executed
   `asked` range ends exclusive, as the time layer serves it (`time/wire.ts`, `asked` carries
   `edge: 'exclusive'`). A sample exactly at an excluded stop is outside W. A declared
   `period.queried` is read as the results layer reads it, `[from, to + step)`.
3. **Place the subject**: the complete scoped identity (§ 4). No value for a dimension, or a
   value no read of this leg resolved and `claimScope` does not name: `subject-unplaced`. A
   value that joins two different identities (node `7` in two clusters when the claim does
   not say which; an alias two resolved entities declared): `subject-ambiguous`.
4. **Select the reads**: this leg's attempts of the claim's tool whose executed scope
   (`executedScope` over the arguments `execute` received) equals the subject's identity on
   every dimension; for a span claim, the attempts whose executed window meets W. Per scope,
   the LATEST attempt decides, failures included: if it failed, was withheld, never finished
   or returned no bound result, the claim is `latest-read-failed` (an older success is never
   reused). Rows of an earlier leg: `stale-turn`. A call of a tool that is not a declared read,
   dispatched after a selected read in this leg (a same-batch call counts as after):
   `superseded-by-write`. A selected result in a shape that does not bind: `result-unbound`.
5. **Freshness**, for a point claim only, when the contract declares `maxAgeSeconds` (#195):
   the age of `measured_at` at the delivery decision; older is `stale`; none is
   `no-measured-at`. A span claim is about fixed instants, so coverage, not freshness,
   decides it.
6. **Collect observations** from the selected results: rows whose subject is the claim's and
   whose field is the claim's. An observation's identity is `(resultId, position)`: the row's
   place in the envelope or rowset. Its content key is `(subject, field, t)`. None: when rows
   of that subject exist without the field, `field-unbound`; when rows of that field exist
   for other subjects only, `subject-mismatch`. On `subject-unplaced` and `subject-mismatch`
   alike, when the answer's value appears under another subject, the reason carries that note
   (the probe: "1200 appears only under Customer A"). The note explains; it never binds.
7. **Unit**: let U be the field's declared unit and A the answer's. No U and A given:
   `unit-undeclared`. A equal to U: compare as is. A a declared scale of U (the figures dial's
   1000^k / 1024^k families): compare after the scale, and the label names the scale. Else
   `unit-mismatch`.

**B. The operand set**

8. **A point claim** (`value`): the observation(s) of the subject and field at the claim's
   time. With `window: 'none'`, the latest observation in the selected result; with
   `claimScope.window`, the observation at that instant. A row whose `grain.aggregation`
   says it is a fold is not a point: `operation-mismatch` (the claim should have declared the
   fold and a window). Two observations at one time with different values: `rows-disagree`.
   None at the claim's time: `window-outside` when observations exist outside it;
   `window-undeclared` when no row has a time and no period is declared.
9. **A span claim** (`mean`, `min`, `max`) binds in one of two ways, and the way is decided
   by the rows' declared grain, never by the answer's value:
   - **A tool fold.** An observation whose `grain.aggregation` is compatible with the claimed
     operation (`mean` ↔ `avg` or `mean`; `max` ↔ `max`; `min` ↔ `min`; anything else, and any
     `is_counter: true`, is `fold-incompatible`), whose `entity` is the subject, and whose
     fold window equals W (a fact: the result's `period.queried`; a series point: the one
     interval at `t`) under `periodTimeCheck`'s equality. A fold over another window is
     `window-differs`, never a contradiction: it is a different statistic.
   - **Point samples the library folds.** When the rows are samples finer than W: every
     distinct observation whose `t` lies in W under W's convention. Requirements, each a
     reason when unmet: one declared `grain.interval` across every selected result
     (`grain-undeclared`, `grain-mixed`); the read's `held` covers W (`periodVerdict` is
     `covered`; `partly-held` is `coverage-partial`, `not-held` is `coverage-not-held`,
     `unknown` is `coverage-unknown`); the operand set is complete: its count equals the
     number of cadence stops inside W under W's convention (`operands-incomplete`, with the
     count found and the count expected). Duplicates (the same content key from retried or
     overlapping reads) collapse to one operand when their values are equal and are
     `rows-disagree` when not. Each operand has equal weight: one declared interval means
     equal-width buckets, which is the only weighting v1 admits. A sample belongs to W by its
     `t` alone; the library does not reason about a bucket that straddles an edge.
   A composed coverage gap bearing on the population is stated on the label and never
   changes the verdict (the typed negatives' rule: a gap is stated, not a withhold); a gap on
   the PERIOD is coverage, and coverage must be sufficient for the claimed operation: store
   retention of the window and a complete returned operand set are two different facts, and
   both are required.

**C. Compare or compute, then decide**

10. **A point claim**: `compareClaimValues`, both ways round (#195), decimals at the answer's
    own precision (`roundsTo`), text and vocabulary exactly after the declared table,
    instants by `compareInstants`. Equal: **observed**. Different: **contradicted**
    (`value-differs`).
11. **A tool fold**: the same comparison against the fold's value. Equal: **observed**.
    Different: **contradicted**.
12. **A library fold**: compute the ONE declared operation over the complete operand set in
    exact decimals (`numberPrecision.ts` · `decimalsOf`, the BigInt path `scientificDecimalOf`
    uses), then compare at the answer's precision. Equal: **calculated**, the operation and
    the operand count named. Different: **contradicted**. A singleton operand set — the
    cadence has exactly one stop inside W — is complete, and the mean of one sample is that
    sample: calculated, labelled "1 reading". One sample where twelve are expected is
    `operands-incomplete` in B, never observed and never contradicted.

A claim that fails in B for coverage or completeness may get a SEPARATE statement, written
by the library from the rows with its own scope and its own verdict (§ 7, "A narrower
statement"). It never supports the model's claim.

Two axes come out of it. The **kind** is one of `observed`, `calculated`, `interpretation`,
`missing`. The **verdict** is `supported`, `contradicted` or `not-checked`. An observed or
calculated claim is supported; a claim whose complete operands give another value is
contradicted; every failure in A or B is not-checked, and the claim's kind is `missing` with
the reason. An interpretation is never supported and never contradicted.

The failure modes, in one table:

| Reason | Part | Fires when | The probe or case |
|---|---|---|---|
| `declined` | A | the field is absent, `null` or `'unknown'` | an honest "I don't know" |
| `subject-unplaced` | A | a dimension has no value, or a value no read of this leg resolved and `claimScope` does not name; the account adds where the value does appear | Codex's probe: nothing was read about Customer B; "1200 appears only under Customer A" |
| `subject-ambiguous` | A | the supplied dimensions join two identities, or an alias two entities declared | node `7` read in two clusters; the claim names only the node |
| `latest-read-failed` | A | the latest attempt for the scope failed, was withheld, never finished or returned nothing bound | a success at 09:14, then a failed read of the same node at 09:16 |
| `stale-turn` | A | the bound read belongs to an earlier leg | an answer after a pause, from the read before it |
| `superseded-by-write` | A | a non-read call after the selected read, same leg | a reset after the metrics read |
| `result-unbound` | A | the result declares neither envelope nor subject column | plain JSON from an MCP tool |
| `stale`, `no-measured-at` | A | a point claim older than `maxAgeSeconds`, or with no `measured_at` | a cached balance |
| `subject-mismatch` | A | a read placed the subject, and rows of the field exist for other subjects only; the same note | a read for B returned `absent()`; A's 1200 is the only balance |
| `field-unbound` | A | rows of the subject exist, none carries the field | `credit_limit` served, `balance` claimed |
| `unit-undeclared`, `unit-mismatch` | A | the answer states a unit the field does not declare, or another unit | "87 MB" over a field in GB |
| `operation-mismatch` | B | a point claim meets a fold row | an hourly average served to a "right now" claim |
| `window-outside` | B | every observation of the subject and field lies outside W, or outside the point claim's time | node 7's 07:30 reading for the 08:15–09:15 claim |
| `window-undeclared` | B | no row time and no declared period | a result with rows and no `t`, no `measured_at`, no `period` |
| `window-differs` | B | a compatible tool fold over another window | a daily average served to an hourly claim |
| `fold-incompatible` | B | the rows' declared aggregation is not the claimed operation, or the values are counters | a `max` fold served to a `mean` claim |
| `grain-undeclared`, `grain-mixed` | B | samples with no declared interval, or two intervals across the selected results | a rowset for a span claim; a 5-minute and a 1-minute read of one node |
| `coverage-partial`, `coverage-not-held`, `coverage-unknown` | B | the read's `held` does not reach all of W, none of it, or is `unknown` | a nightly export asked about the last hour; a store that holds the second half only |
| `operands-incomplete` | B | fewer samples inside W than the cadence expects | one 08:30 reading for an hour at 5 minutes |
| `rows-disagree` | B | two observations with one content key and two values | two reads of one store that disagree |
| `value-differs` | C | complete operands under the declared operation give another value | 87 stated; the mean of the twelve readings is 71.3 |

## 7. The four kinds, and how each is labelled

| Kind | When | The account's line (library-rendered, fixed templates, versioned) | The standing line | The standing |
|---|---|---|---|---|
| **observed** | a point claim equal to its observation, or a span claim equal to a compatible tool fold over W (§ 6 steps 10–11) | "Observed — `node_metrics` returned cpu_pct for node-7 at 09:10, read 09:15, covering 08:15–09:15." / "Observed — `node_metrics` returned the hourly average of cpu_pct for node-7 over 08:15–09:15." | nothing; under "known": "Known — N values observed in results of {who}" | counts toward the tie check behind "known" with enforce (#195 § 3.5, § 10) |
| **calculated** | the declared operation, recomputed over a complete operand set (step 12) | "Calculated — the answer's cpu_pct is the mean of 12 readings of node-7 between 08:15 and 09:15 (every 5 minutes), from `node_metrics`; the library recomputed it." | nothing | counts like observed, under the declared operation and a complete operand set only (open question 1) |
| **interpretation** | a field declared `kind: 'interpretation'`† with `of: [fields]` | "Interpretation — the answer's status is the model's reading of cpu_pct (observed) and cpu_peak (calculated); the record holds no rule for it." | "'status' is the model's reading of observed values" | never supports; the whole answer is then "consistent with the record" at most (below); `claim-unbound` on an `of` field that is not observed or calculated |
| **missing** | declined, or any not-checked reason of § 6 | "Missing — the answer states cpu_pct for node-7 over 08:15–09:15; no result of this turn can settle it: `node_metrics` read 07:00–08:00 for node-7, and the value appears only under node-9." | "the record holds no value for {subject}'s {field} in the window asked" | `claim-unbound`†, not sure; `declined` fires nothing new |
| contradicted (a verdict, not a kind) | complete operands, another value | "Contradicted — the answer's cpu_pct for node-7 over 08:15–09:15 differs from the mean of the 12 readings `node_metrics` returned (read 09:15)." | "a value the answer states differs from what {who} returned" | `claim-contradicted` (planned in `honesty/README.md` § 4.2), not sure |

**How a calculation is checked.** The operation is declared on the claim and checked for
compatibility with the rows' declared fold BEFORE any number is compared (§ 6, part B). The
set is closed and narrow in v1: `mean`, `min` and `max` over the samples of ONE subject and
ONE field inside W, each recomputed in exact decimals and compared at the answer's
precision. The operand set must be complete (every cadence stop inside W), from reads whose
`held` covers W, with one declared interval and equal weights; duplicates from retried or
overlapping reads collapse when equal and refuse when not. Nothing is tried in turn: a
`mean` claim is compared to the mean, and a `max` fold of 87 never supports `cpu_pct: 87`
when `cpu_pct` claims a mean. The figures dial's multi-column arithmetic (sums, ratios,
differences, complements) is NOT admitted for a claim in v1: each needs every operand and its
order declared, and that binding is deferred (§ 14). The coincidence window the figures dial
names (±0.5 for a whole number) remains for a calculated value and is reported, not hidden;
with the operands fixed by binding it is no longer a search over the results.

**A narrower statement is the library's claim, not the model's.** When part B fails because
the store held only part of W, or the operand set is incomplete, the model's claim stays
not-checked (a value over the part is not a value over the whole: a window that averages 50
can have a second half that averages 100). The library may then write its OWN statement from
the rows, on the precedent of the typed negatives' statements and #195's recorded value:
"Over 08:45–09:15, the part `node_metrics` held, the mean of 6 readings of cpu_pct for node-7
is 100%." It carries its own scope, its own kind (observed or calculated) and its own verdict;
it is vouched by the library and the tool; it appears in the account and, under enforce, as
the recorded value (#195 § 3.6). It never supports the model's claim, and the standing's
period reason fires as today.

**What an interpretation is.** A word or sentence the model wrote over observed values:
"high", "healthy", "stable", "improving". The library cannot verify it and does not try. It
labels it as the model's, names the observed values it reads from, and never lets it count
toward "known". A claim field whose value is outside its declared vocabulary is not an
interpretation; it is `incomparable` (#195's table) and not checked.

**The whole answer is never an unqualified "known".** The tie check behind "known" (§ 10)
requires every field of the delivered candidate that states a value to be a supported claim
or a field the app prints from `claimScope` or the record. An interpretation field that
states a value is a declared exception to `unchecked-field`: it is delivered, it fires no
reason, and it fails the tie check, so the answer folds to "consistent with the record"
(`unrefuted`: nothing fired, and nothing supports the WHOLE), and the line names the field.
This is a delivery acceptance test, not a note: an answer with an interpretation field that
states a value never reads `known`, on the line, on `turn_end.answerAssessment` and in
`agent.assessment()`. The checked fields keep their per-field labels in the account. An app
that wants "known" beside a model's reading prints the reading outside the checked answer.

**Fields the contract does not name.** Under a contract, such a field that states a value is
`unchecked-field` (#195): not checked, never known, withheld under enforce. The account's
"How sure" row says: "Values in fields the contract does not name were checked for appearance
in results, not for what they are about."

## 8. Beside names-and-numbers

| | names-and-numbers | V1 |
|---|---|---|
| The question | did the value appear in a result the run read? (F3) | do rows bind it to the claimed subject, field, unit and window, under the claimed operation, with coverage? (F4) |
| Reads | every token of prose and typed answers | typed claim fields only |
| Evidence | every `role: 'tool'` message, text or JSON | eligible rows of this leg: the envelope, or declared columns |
| Verdict | grounded / flagged (membership) | kind + verdict (§ 6) |
| Standing | `value-unsupported`; a clean pass never supports | `claim-unbound`, `claim-contradicted`; observed or calculated under enforce is the tie check |
| Opt-in | `.namesAndNumbersFromEvidence()` | the scoped `.claims()` contract over `.outputSchema()`, under `agentChecks: ['claims']` |

When both run, the order is fixed and its limit is named:

1. **The gate runs first, as today**: on the draft at Route (`route.ts` · `judgeEvidence`),
   with its one repair turn under `guard`, and on the delivered candidate inside answer
   validation (`core/agent/stages/answerEvidence.ts`). **V1 runs on the delivered candidate
   only**, in the same validation, before the gate's candidate row is written.
2. **The draft-time limit, stated.** A valid calculated value — a mean no row carries — can
   be flagged by the gate at the draft, and under `guard` the repair turn can ask the model
   to replace it, before V1 ever sees it. Candidate-only V1 accepts this as an initial
   limit: it is documented here, and the bench measures it ("repair turns asked on a true
   calculated value", § 13). Binding at the draft is an open question (§ 15).
3. **Computed credit is tied to one field.** V1's calculated value for the candidate is handed
   to the gate's judge as a `computed` entry (`EvidenceVerdict.computed`, `derivation` the
   claimed operation, `from` naming the operand rows) for the JSON PATH of that claim field
   only. The typed reader carries the path of each literal it yields (`extract.ts` ·
   `readAnswer`, `answerTexts`, a build change†), so the same number in an undeclared or
   prose field is looked up as before and flagged when no row carries it. Credit never
   attaches to a number; it attaches to a field, a subject and an operation.
4. **V1 never widens the gate.** A point or fold observation is a row in the corpus the gate
   read, so an observed value is always grounded; a calculated value is grounded only through
   its own field's credit. Pinned by a property test (§ 12).
5. **V1 reads nothing from prose**; the gate keeps reading prose and typed values alike.
6. **The figures dial's arithmetic keeps its own law** for prose and for non-claim numbers.
   For a claim field, V1's verdict is the one the standing reads.

## 9. The field case, end to end

The host app's tool, declared:

```ts
const nodeMetrics = defineTool({
  name: 'node_metrics', displayName: 'the node metrics read',
  inputSchema: { /* cluster: string, node: string, window: string */ },
  search: { source: { what: 'the metrics store', said: ['the metrics store'] },
            subject: { what: 'nodes', said: ['node', 'nodes'] },
            arguments: [{ name: 'cluster', role: 'population' }, { name: 'node', role: 'population' },
                        { name: 'window', role: 'period', whenOmitted: '1h' }],
            complete: 'within-arguments' },
  period: { argument: 'window', spelling: 'lookback', direction: 'past', retention: '30d', granularity: '5m' },
  askOrAssume: { window: { assume: '1h' } },
  effects: 'read',
  execute: async ({ cluster, node, window }, ctx) =>
    describedResult({
      series: points,                                     // { t, entity: 'node-7', metric: 'cpu_pct', value }, one per 5 minutes
      grain: { interval: '5m', aggregation: 'avg' },      // each point is the 5-minute average
      units: { cpu_pct: '%' },                            // †
      provenance: { measuredAt: lastSample, source: 'the metrics store' },
      period: { queried: executedWindow, held: storeHeld },
      resolved: [{ argument: 'cluster', id: 'cl-a' },
                 { argument: 'node', id: 'node-7', name: 'node 7', aliases: ['nd7'] }],
    }),
});
```

The person asks "node 7 CPU over the last hour". Under `.time()` the window is confirmed and
the call runs with it: the lookback's executed range is `[08:15, 09:15)`, its end exclusive
as the time layer serves a lookback. At a 5-minute cadence that is 12 stops (08:15, 08:20,
…, 09:10); with an inclusive end it would be 13, which is why the convention travels with
the window. `claimScope` names the cluster (`cl-a`) from the session; the store returns
node-7's points for two hours (the backend's minimum) and, because the host app's store is
shared, node-9's points too. The typed answer is `{ node: 'node 7', cpu_pct: 71, cpu_peak:
87, status: 'high' }` under the contract of § 4.

| Step | What V1 reads | Outcome |
|---|---|---|
| operation, window | `cpu_pct` claims `mean` over W = `[08:15, 09:15)` | a span claim |
| subject | `cl-a` from `claimScope`; `node 7` equals `resolved[].name` of this leg's read | placed: `(cl-a, node-7)` |
| reads | one attempt of `node_metrics` with that executed scope, the latest, returned | selected |
| observations | series points with `entity: 'node-7'`, `metric: 'cpu_pct'` | 24 points; node-9's 24 points are never candidates |
| grain | `interval: '5m'`, `aggregation: 'avg'`: samples finer than W, compatible with a library `mean` of 5-minute averages | a library fold |
| operands | `t` inside W under its convention | 12 of the 12 expected: complete |
| coverage | `period.held` covers W; `complete: true`; no gap | covered |
| unit | `units.cpu_pct` is `%`; the answer states none | compare as `%` |
| value | the mean of the 12 points is 71.3; at the answer's precision, 71 | **calculated**, `mean`, 12 readings |
| `cpu_peak` | the same operands; `max` is 87 | **calculated**, `max` |
| `status` | `kind: 'interpretation'`, `of: ['cpu_pct', 'cpu_peak']`, both calculated | **interpretation**, fires nothing |

Standing: "consistent with the record" — the two claims are supported and the interpretation
field states a value, so the tie check fails and nothing fires. The line: "Consistent with the
record — 2 values calculated from results of the node metrics read; 'status' is the model's
reading of them." Without the `status` field, and under enforce with the app's checks passing,
the same answer reads "known".

The same question with other drafts:

| The answer | Where it came from | V1 |
|---|---|---|
| `cpu_pct: 87` | node-9's point at 07:40 | the operands are node-7's 12 readings, complete; their mean is 71.3: **contradicted**, `value-differs`. The account adds: "87 appears only under node-9." |
| `cpu_pct: 87` | node-7's own peak at 08:50 | the same complete operands, the declared operation is `mean`: **contradicted**. The maximum is never tried for a field that claims a mean. The `cpu_peak` field is where 87 is **calculated**, `max`. |
| `cpu_pct: 87`, and the store returned one sample, 08:30 | a single reading | 1 of 12 expected: `operands-incomplete`, kind **missing**, not checked. Never observed: one reading at one moment is not an hour. |
| `cpu_pct: 87`, from a tool whose grain is `interval: '1h', aggregation: 'avg'` with one point at 08:15 | a tool fold over W | compatible fold, window equals W: **observed** (the tool's hourly average). With `aggregation: 'max'` instead: `fold-incompatible`, not checked. |
| `cpu_pct: 100`, and the store held `[08:45, 09:15)` only, all 100 | the held half | `coverage-partial`: kind **missing**, not checked; `period-partly-held` fires as today. The library's own statement: "Over 08:45–09:15, the part the node metrics read held, the mean of 6 readings of cpu_pct for node-7 is 100%." It never supports the model's 100 for the hour. |
| `cpu_pct: 64` | node-7's point at 07:30 | 12 complete operands in W, mean 71.3: **contradicted**. The account adds: "64 appears for node-7 only at 07:30, outside the window." |
| `cpu_pct: 71`, with no `claimScope` cluster, and the leg read node 7 in `cl-a` and `cl-b` | two identities | `subject-ambiguous`, kind **missing**, not checked. |
| `cpu_pct: 71`, after a second read of the same scope failed at 09:16 | the latest attempt failed | `latest-read-failed`, kind **missing**, not checked; the 09:14 success is never reused. |
| `cpu_pct: 71`, from two overlapping reads (`[08:00, 09:00)` and `[08:30, 09:30)`) | retried or overlapping reads | duplicates by content key collapse when equal; the union is the operand set; 12 of 12: **calculated**. One shared `t` with two values: `rows-disagree`, not checked. |
| `cpu_pct: 71`, from a read of a tool that declares no `units` and no `entity` | a plain JSON result | `result-unbound`: kind **missing**; the gate still grounds `71` only if some result spells it. |
| `cpu_pct: null` | the model declined | **missing**, `declined`; nothing new fires. |

Codex's probe runs the same way with facts instead of series: the contract declares
`owes: { tool: 'get_balance', fact: 'balance', operation: 'value', subject: { fields: {
customer: 'customer' } } }`; the answer says `{ customer: 'B', owes: 1200 }`; the one read of
this leg resolved `A`, and its only `balance` row has `entity: 'A'`. Nothing was read about B:
`subject-unplaced`, with the note "1200 appears only under Customer A"; kind missing,
standing not sure. Had the model also read B and received `absent()`, B is placed and the
reason is `subject-mismatch`, with the same note. The gate grounds `1200` in both runs, as it
did in the probe.

## 10. The record, the standing, the account

- **One committed row per claim per judged candidate**, `claim-binding`†, on
  `findingsLedger` through the one writer (`core/agent/findings/ledger.ts` · `appendRows`):
  `turn`, `candidateDigest`, `answerField`, `kind`, `verdict`, `reason?`, `subject` (the
  resolved identity, as `coverageDeclared` rows already carry resolved ids), `field`,
  `operation`, `unit?`, `window?` (two instants and the end edge), the selected results'
  `resultId`, `toolCallId` and `toolName`, the operand observations' identities and their
  count, the count expected, and the rule version. Never a value from the answer or a row:
  values stay on the receipt (#109's `ResultEvidence.facts`, under the app's grant) and are
  kept out by name like everything else.
- **One report row per claim** (`AnswerCheck`, id `agent:claims:<field>`, through
  `claimChecksOf`): supported → `checked-pass`, contradicted → `checked-fail`, not-checked →
  `unreachable`, declined → `not-applicable`. This is the one law V1 changes, and it is the
  change #195 already rules: an agent row is `checked-pass` only for the scoped contract's
  observed and calculated claims (`validate.ts` refuses a pass from any other agent row). The
  short form stays as it is.
- **The tie check behind "known"**: every required claim supported, and every field of the
  delivered candidate that states a value either a supported claim or printed by the app
  from `claimScope` or the record. An interpretation field or an undeclared field that
  states a value fails it; the answer is then "consistent with the record" at most (§ 7).
- **Reasons** in `REASONS`: `claim-unbound`† (layer 4, class not-sure, rests on `answer`: the
  answer states a value the record cannot bind) and `claim-contradicted` (layer 4, not-sure,
  rests on `calls`: the selected reads). Not-checked rows fire `check-unreachable`, as every
  armed check that reaches no verdict does. `checked` gains `claim-binding`† (layer 4): `of` =
  the claim fields that state a value, `ran` = those with a verdict.
- **The line** (`compose.ts` · `standingLineOf`) names a reason's calls by `displayName` only
  (H4). New clauses: the two of § 7 and the interpretation clause, in `NAMED_REASON_WORDS`
  with their unnamed forms.
- **The account**: one line per claim field under "It found" (`RowId` `found`), labelled by
  kind, vouched by the weakest truth-deciding input: observed and contradicted by
  `tool:<name>` (the rows) and the library (the match); calculated by the library;
  interpretation by the model; missing by the library; the library's narrower statement by
  the library and the tool. "How sure" counts them beside the reasons. The operand rows' leaf
  joins the show-me allow-list as a derived `{ value, unit, t, at }`†, so "show me" reaches
  the rows without a tool result's bytes.
- **No new event in v1.** The report and the row carry the verdict; the fold never reads
  events.
- **Checkpoints.** Rows ride `findingsLedger` as every row does. Binding is per leg: a read
  before a pause cited after it is `stale-turn`, as typed negatives rule. Receipts across a
  pause are #109's carrier, mounted with the build.
- **Redaction.** Subject ids, field names and tool names are names; a policy that selects a
  state key keeps its values out, and the account says "kept out", never "no value".
- **Bounds** (proposals): 32 claims per contract; 10,000 observations read per claim and
  10,000 operands per fold, then `unreachable` with the count; 256 characters per subject
  spelling; every copied object through `copyJson` with its limit.

## 11. Threat model

| Input | Trust | It cannot |
|---|---|---|
| The model's draft and its typed fields | untrusted | choose the evidence, the row, the subject, the window or the operation; pass by naming a subject the record did not resolve; make a value observed by writing it twice; make a maximum pass as an average |
| **A value from the wrong subject or window** | — | bind: the rows must name the claim's complete subject and lie in its window; the value's appearance elsewhere is the explanation, never support (§ 6 steps 3–8) |
| **A statistic of the wrong operation** (a peak served or written where a mean is claimed) | — | bind: the operation is declared on the claim; a fold's declared aggregation must be compatible before any comparison; no operation is chosen because it reproduces the number |
| **A narrower read** (the store held half the window; the operand set is short) | — | verify the claim about the whole: the claim stays not-checked; the library's own statement about the part carries its own scope and never supports the model's |
| **Unit confusion** | — | bind silently: no unit on the field admits a unitless claim only; a unit the answer states must equal the declared one or be a declared scale; a conversion is named on the label |
| **A subject alias** | the tool's `resolved[].aliases` and the app's normalizer are the trusted base | be invented by the model: a spelling neither declares places nothing (`subject-unplaced`); an alias two entities declare is `subject-ambiguous`. The cost is over-abstention on spellings the app forgot; it is counted (§ 13), and the fix is a declaration, never a looser match |
| **Partial coverage** | the read's declared `held` and composed gaps | be hidden: `partly-held`, `not-held` and `unknown` never observe a span claim, and the period reason fires |
| **A model inventing a binding** | — | happen: the model declares no binding. Its only levers are the subject fields and the values, both checked against rows. A `restsOn`-style hint is not read in v1 |
| **A tool declaring a binding it cannot honour** (a `%` unit over fractions; a subject column holding display names; an `avg` grain over raw samples; a `measured_at` over cached data) | the trusted base, as every declaration is | be caught by V1 in general: the check vouches for agreement with the tool, not for truth, and local provenance does not establish tool truth. What can be checked is refused at the mint (§ 5); the `check:semantics` gate judges sample results; declarations carry versions on the row; the bench scores a misreporting tool apart (§ 13) |
| Tool text, and instructions inside it | untrusted | add a row; sway a value into support: a swayed value is checked like any other |
| A result passed through from another process (an MCP structured result, an HTTP body carrying `af_semantics: true`) | untrusted | bind: `result-unbound` in v1 (#195's envelope-origin rule) |
| Two reads of one subject that disagree; a newer failed read | — | let the model pick: `rows-disagree`; `latest-read-failed`: an older success is never reused |
| A write after the selected read | — | hide behind the read: `superseded-by-write` |
| A saved checkpoint | shape-checked only | revive a binding from another leg: `stale-turn` |
| The app's contract, normalizers, `claimScope`; each first-party tool's declarations and minted envelopes | the trusted base | — |

**Fail closed.** Any error, limit, timeout, unparseable time, missing declaration or ambiguity
is not-checked, never supported. A supported claim is always rows the record holds, under
the operation the contract declared.

## 12. Test plan

Scripted, mock provider, no paid call. These test the registered cases; they prove nothing
beyond them.

- **Codex's probe**: `{ customer: 'A', balance: 1200 }` served; `{ customer: 'B', owes: 1200 }`
  answered → `subject-unplaced`, kind missing, the account's "appears only under A" note,
  the standing not sure, the gate still grounded. The variant where a read for B returned
  `absent()` → `subject-mismatch`, the same note. And the control:
  `{ customer: 'A', owes: 1200 }` → observed, supported.
- **The CPU case**, each row of the § 9 tables: calculated 71 (`mean`) and 87 (`max`);
  contradicted 87 (node-9), 87 (node-7's peak under a `mean` claim) and 64 (07:30); the
  single-sample claim `operands-incomplete`; the hourly tool fold observed, and
  `fold-incompatible` for a `max` grain; the half-held store not checked, with the library's
  own narrower statement; `subject-ambiguous` for node 7 in two clusters;
  `latest-read-failed` after a failed same-scope read; overlapping reads collapsing by content
  key, and `rows-disagree` on a shared `t`; `result-unbound`; declined; the interpretation
  label; node-9's points never candidates.
- **Singleton and multi-point controls**: one sample where the cadence expects one (interval
  equals the window) → calculated, "1 reading"; one sample where twelve are expected →
  `operands-incomplete`; twelve of twelve → calculated; eleven of twelve → incomplete, with
  both counts on the row.
- **Operation binding**: a `mean` claim against `avg`, `mean`, `max`, `sum`, `count` and
  `is_counter: true` grains, each with the expected verdict; a `max` claim the same way; the
  number that a non-declared operation would reproduce is never credited.
- **Unavailable operands**: a span claim over a rowset (`grain-undeclared`); two intervals
  across two reads (`grain-mixed`); a declared scale with no declared unit
  (`unit-undeclared`); a point claim against a fold (`operation-mismatch`).
- **The narrower calculation**: a window that averages 50 whose second half, all 100, is the
  part held → `coverage-partial`, not checked, never supported; the library's statement
  carries `[08:45, 09:15)` and 6 readings, and the model's claim row still reads not-checked.
- **Scope and selection**: node `7` in two clusters, with and without `claimScope`; a success
  followed by a failed same-scope lookup; a success followed by a successful same-scope read
  (the latest decides); an alias two entities declare; a read of another cluster never
  selected; `stale-turn` across a pause; `superseded-by-write` from a same-batch non-read
  call; freshness on a point claim (`stale`, `no-measured-at`), and no freshness on a span
  claim.
- **Windows and edges**: a lookback's `[from, to)`; a `bounds` form with `edge: 'inclusive'`
  and with `edge: 'exclusive'`; a sample exactly at an excluded stop stays outside, and at an
  included stop inside; the expected count follows the convention (12 against 13); a `t`
  without an offset read with the result's period offset, and refused without one; a
  declared `queried` read as `[from, to + step)`.
- **Every reason of § 6**, one test each.
- **Units**: no unit declared; equal; a declared scale (GB stated over a TB field, named on
  the label); a mismatch; an opaque label compared by equality; ISO 4217 for `money`.
- **Calculations**: `mean`, `min`, `max` in exact decimals (no float slack), pinned against an
  independent oracle like the scientific-notation property test; the precision window at
  whole and one-decimal precision; equal weights over equal buckets.
- **Interpretations, as a delivery acceptance test**: an answer whose claims are all
  supported and whose interpretation field states a value never reads `known` on the line,
  on `turn_end.answerAssessment` or in `agent.assessment()`; it reads `consistent`, the line
  names the field, and the account keeps the per-field labels; the same answer without the
  interpretation field reads `known` under enforce.
- **Unchecked fields**: an undeclared field that states a value → `unchecked-field`, never
  known, withheld under enforce; the account's sentence.
- **Gate order, through the real Agent with the mock provider**: a valid mean in the declared
  field is credited to that field's path and not flagged at the candidate; the same number
  reused in an undeclared prose field is looked up as before and flagged; under
  `posture: 'guard'` the draft-time repair turn is asked on the valid mean (the documented
  limit), and after it the candidate's calculated value is still labelled calculated.
- **Properties**: an observed value is grounded by the gate (never widened); adding a result
  never turns a not-checked or contradicted claim into supported except through rows that
  bind it under the declared operation (monotone in the #197 sense); the in-run rows equal
  the read-after fold (`assessAnswer` over the recording, the equality law).
- **Declarations refused at the mint**: a `units` field no row carries; two subject columns; a
  time column that does not parse; a unit outside the vocabulary; an aggregation with no
  interval.
- **The account and the line**: goldens for the four kinds, the contradiction and the
  library's narrower statement; the line's named and unnamed clauses; `displayName` used,
  the registered name never.
- **Byte identity**: an agent without the scoped contract is byte-identical, every reference
  under `test/core/tools/reference/` unchanged; the short form of `.claims()` unchanged.
- **Mutation tests**: each failure reason has at least one mutant that makes the check
  supported, and the suite catches it.

## 13. Measurement plan

The question is two-sided: does V1 catch wrong bindings, and does it stay quiet on correct
answers? Both are tested on registered cases; a finite set of cases with zero errors is not
a universal guarantee, and this page makes none.

**Independent adversarial cases first.** Before the build is tuned, an author who did not
write the build freezes a set of adversarial cases with oracle labels: wrong scope (another
node, another cluster, an alias), wrong aggregation (a peak for a mean, a counter for a
gauge, a daily fold for an hourly claim), and incomplete coverage (a half-held store, a short
operand set, a read with no grain). The build is then run against them unchanged; a case it
fails is reported, not re-labelled.

**Registered rule `binding-rule-v1`**† (`bench/binding/RULE.md`†, written before any paid
call, on the figures bench's pattern — `bench/figures/RULE.md`):

- **Model**: Haiku 4.5 only, through the package's own adapter; the answer bench's protocol.
- **Tasks**: two typed-answer tasks. (1) The node task of § 9 over a fixture store with
  several nodes, two clusters and several hours; (2) the customer balance task of the probe
  over a fixture with several customers. Each fixture holds a world table, read by the tools
  and by a deterministic fixture reader that labels every stated claim true or false with its
  own comparison code.
- **Cases**: controls (the person names one subject; the answer should be observed or
  calculated); provoking (a shared store that returns neighbouring subjects and extra hours;
  a store that returns a fraction under a `%` field; an alias spelling; a half-held read; a
  question that invites a peak where a mean is claimed; a question that invites an average
  over two clusters); fail-closed (no alias declared; a read that declares no grain; a remote
  tool; the same node in two clusters); a misreporting tool (the world says 64, the tool
  serves 87), scored apart.
- **Planted drafts**: on every control and provoking case, 3 extra runs swap the model's final
  draft for a planted wrong one after the real tool turns: the neighbour's value, the value
  from the hour before, the peak in the mean's field, the value in the wrong unit, a value no
  row carries. At least 20 planted drafts reach the checker, else NOT-MEASURABLE.
- **Pass bar**, on the registered cases: false `supported` 0 (a planted or natural false claim
  labelled observed or calculated); false `contradicted` 0 (a true claim contradicted);
  needless not-sure on natural true answers (`claim-unbound` or `check-unreachable` on a true
  claim) ≤ 0.10 over ≥ 40 answers, with `subject-unplaced`, `subject-ambiguous`,
  `window-undeclared`, `grain-undeclared` and `unit-undeclared` counted apart as declaration
  gaps; the gate's verdict on observed values grounded 100%; repair turns asked on a true
  calculated value, counted and reported (the § 8 limit); an answer with an interpretation
  field never `known`, 100%; model calls per run equal to the unarmed agent (V1 adds no
  turn); in-run rows equal the read-after fold 100%.
- **Reported**: per case, with intervals that treat the case as the unit; the reason mix; the
  misreport case apart; the declaration gaps, since they say what an app must declare before
  V1 is quiet; the independent adversarial set's results, case by case.
- **What a pass licenses**: shipping the scoped contract opt-in for typed direct facts and
  the three admitted operations, on Haiku 4.5, single turn, for the registered task shapes.
  Nothing about prose, other models, other operations or follow-up turns.
- **Cost**: about 170 runs; estimate under $1; cap `--max-usd 1.50`. **No paid run is
  authorized by this note**; it waits for the owner's budget go.

The figures bench's known limitation ("whichever pool the person asked about") becomes a
zero-cost replay here: its fixture's pool rows, with a subject column declared, must bind the
asked pool only.

## 14. Not in this design

- Prose claims. Prose binds nothing; an app moves a claim into a typed field.
- Multi-column operations: sums, ratios, differences and complements over claims. Each needs
  every operand and its order declared; a later design.
- Weighted folds (unequal buckets, sparse samples), medians, percentiles, counts.
- A correction turn (#195 § 7.4 keeps it off; v1 builds none).
- A model-cited handle (`restsOn`) narrowing the binding.
- Binding at the draft, before the gate's repair turn.
- Remote (MCP) results binding; a foreign envelope settles nothing in v1.
- An app-supplied rule for an interpretation (`given` provenance over a model word): a
  later design.
- Binding across legs or turns; receipts carried through `continueFrom`.
- Changes to the gate, the corpus, the exempt corpus or the figures dial's own arithmetic,
  beyond the path the typed reader gains (§ 8).
- The time layer's `current` shape (`2026-10-time-interpretation.md`, § 8.1) is not built; a
  claim about "right now" binds as a point "as of" the row's time, nothing more.

## 15. Open questions, with proposed answers

1. **Does a calculated value count toward "known"?** Proposed: yes, under the declared
   operation and a complete operand set only, because the operands are observed rows and the
   arithmetic is the library's. The figures dial's `computed` never counts, and still does not.
2. **Which operations in v1?** Proposed: `value`, `mean`, `min`, `max`. `sum` and `count` over
   points, medians and percentiles wait for a case; multi-column arithmetic waits for its own
   operand binding.
3. **Should V1 also bind at the draft**, so the guard's repair turn does not ask the model to
   replace a correct mean? Proposed: not in v1; the limit is documented and measured (§ 8,
   § 13), and the draft-time repair stays the figures dial's concern.
4. **A `restsOn` hint**, as typed negatives use? Proposed: no, until a bound shows the total
   binding too costly.
5. **A new event?** Proposed: none; the row and the report carry the verdict.
6. **Remote results.** Proposed: `result-unbound` in v1; a later design can let the app
   register a remote tool's columns locally, with the envelope-origin question answered.
7. **The unit vocabulary.** Proposed: `FIGURE_UNITS`, `/s`, ISO 4217, and opaque labels by
   equality. Temperatures, counts and durations wait for a case.
8. **Where `units`† lives.** Proposed: on the envelope and on the column, one vocabulary; a
   tool-level `Tool.units`† is refused when it disagrees with an envelope.
9. **The library's narrower statement under enforce.** Proposed: delivered as the recorded
   value only when the app has a template for it (#195 § 3.6); otherwise it stays in the
   account and the delivery is "I don't know" with the limitation.
10. **A bucket that straddles an edge.** Proposed: a sample belongs to W by its `t` alone in
    v1; a tool whose buckets end at `t` rather than start there declares nothing today, and
    a `grain.anchor`† declaration is a later addition if a case needs it.

## 16. Decisions

1. V1 checks a typed claim field with its subject, field, unit, window and coverage, under
   the operation the claim declares. Prose binds nothing; an undeclared field is
   `unchecked-field`.
2. The app declares which fields are claims, what settles each and which operation each
   claims; the tool declares what its rows are about and how each value was folded; the
   library binds. The model declares nothing and names no evidence.
3. Two result shapes bind: the envelope (`facts` with `entity`, `series` with `entity`,
   `metric`, `t`, with `grain` for any span claim) and a rowset with a declared subject
   column (point claims only). Units are declared on the envelope (`units`†) or the column
   (`unit`†). Anything else is `result-unbound`.
4. The subject is the complete scoped identity of the claim's tool, from `claimScope` or
   declared subject fields joined to this leg's `resolved` values and aliases, after the
   app's normalizer. No fuzzy match; two identities are ambiguous, not a match.
5. The window carries the executed range's boundary convention (the form's declared `to`
   edge; a lookback ends exclusive); a sample at an excluded stop is outside. Coverage is the
   read's declared `held` and the completeness of the operand set, two different facts.
6. One point never proves a span claim, whatever the row count. A span claim is observed only
   through a compatible tool fold over the same window, or calculated over a complete operand
   set at one declared interval with equal weights.
7. The operation is bound before the number: fold compatibility is checked first, and no
   operation is chosen because it reproduces the answer. v1 admits `value`, `mean`, `min`,
   `max`; multi-column arithmetic is deferred.
8. A calculation over a narrower window never verifies the wider claim. The library may write
   its own statement about the part, with its own scope and verdict.
9. The check is one control flow: eligible inputs, then the operand set, then the one allowed
   comparison or calculation. Contradiction is possible only in the last part, from complete
   operands; everything else is "cannot check". The inherited safeguards — complete scoped
   identity, the latest attempt including failures, freshness for point claims, observation
   identity — are steps of that flow.
10. Four kinds: observed, calculated, interpretation, missing. Three verdicts: supported,
    contradicted, not-checked. Every failure is named and fails closed.
11. The whole answer is never an unqualified "known" beside a model interpretation or an
    undeclared field: the tie check requires every shown field to be a supported claim or
    app-printed; otherwise "consistent with the record" at most, with the field named. A
    delivery acceptance test pins it.
12. V1 runs on the delivered candidate inside answer validation. The gate runs first and is
    never widened; V1's calculated value reaches the gate as a computed figure for that
    field's path only; the draft-time repair on a true calculated value is a documented,
    measured limit.
13. Two reasons (`claim-unbound`†, `claim-contradicted`), one check (`claim-binding`†), one row
    per claim, one line per claim in the account, no new event.
14. Reused from #109: identity, capture with grants, executed scope on the complete identity,
    reasons, the evaluator. Reused from #195: the position, the contract, comparators, the
    latest-attempt and freshness rules, `unchecked-field`, the delivery table, the recorded
    value, the bench shape. Changed: the subject may come from the answer; a window and an
    operation per claim; a unit door; the row side of binding; calculated and interpretation
    kinds; the narrower statement as the library's own claim; no correction turn.
15. Measured on registered cases before it ships, with an independent author's adversarial
    cases frozen first: zero false supported, zero false contradicted, needless not-sure
    ≤ 0.10 on natural true answers, declaration gaps counted apart. No universal claim, and no
    paid run authorized by this note.
