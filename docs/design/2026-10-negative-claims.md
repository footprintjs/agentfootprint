# Negative claims, honest by construction — "not found", "none" and "the list is complete"

**Status: design, revision 6.2 (2026-10-23). Direction, the full bench plan (≈ $4.30, cap $4.50)
and the raters' plan approved by the owner; § 9 records the decisions.** Revision 2 followed four lens reviews; revisions 3–5 closed verifiers' walks;
revision 6 answers the four-lens review of PR #199/#200 — one blocker and the PR 4 requirements.
PR 1, 2 and 3 (§ 8) are in flight; #199 carries a copy of this note (§ 11 lists what it must
change). It stacks on PR #197 (`agentChecks`: an agent row can withhold, never verify) and fits
PR #195 (`docs/design/2026-10-exact-claims-mounted.md`: the runtime binds a claim; the model never
names the evidence; provider call ids never select; a delivery built from the record carries its
own mark). Paths are under `src/`; code is cited as `file · symbol`.

**The goal, in the owner's words.** A reply states something as fact only when the tool results
establish it, and as not-sure otherwise. The guarantee comes from code, not from the model obeying
text.

**What is guaranteed, exactly (R1).** *A negative the LIBRARY delivers is exact; a negative the
model writes in prose is flagged, not guaranteed.* Under the arm every typed negative claim is
delivered as the library's statement, in every mode; the model's own prose is checked and flagged,
and only an opt-in that § 7 gates may ever withhold on it.

**The decision in one paragraph.** Three parts on existing seams, each byte-identical when off.
(1) A local tool declares once what its search is made of — every input argument classified by
role, every default, built-in qualifier and limit declared, and whether the search is complete for
what it ran with — and the dispatch funnel composes each call's coverage from the arguments in
effect, so a declaration cannot claim more than the search did; a name that resolves to nothing is
a named miss over the known names, with the names outside that list an irremovable gap. (2) A
declaration is a claim, so it is checked like one: a rule pack at definition, at registration, at
the mint and in the `check:semantics` gate; at dispatch only the refusal check, and only when the
delivery check is armed. (3) **The library states negatives; the model only points.** A typed
negative claim cites, by a short handle the library maps to its own result identity, the reads it
rests on and the entity it is about; the library writes the statement from those rows, gaps said
out loud, and delivers it in every mode. An unestablished claim is either withheld with the answer
or replaced by the statement of what WAS searched — the app's choice. A prose detector flags.

## 1. What the study found, and what answers it

| The study found (Haiku 4.5, 819 replies; Sonnet 4.6, 72) | Answered by |
|---|---|
| Declared coverage cut flat "X does not exist" replies mainly where the declaration named the exact gap the question fell into (a per-call "the store holds only part of the window": 11/12 → 1/12). A one-sentence prompt instruction changed nothing | § 3: coverage composed from the arguments in effect names the gap by construction; § 5.1: the library's statement says every gap out loud, and is what the person reads |
| An overclaiming refusal ("No array matches 'X'. Known arrays: … a wrong identifier, not missing data") made replies worse on both models. A pre-check over a known list IS a search | § 3.3: an unresolved name is an absence over the known names, with "names outside the source" a gap the author cannot drop; § 4: a refusal may not assert non-existence |
| Prose instructions and hints rode along; the model never called a hinted tool | § 3: every composed field is data; author prose that instructs is refused where it can reach a statement |
| The registered standing rule failed: text copies, any gap anywhere, a rater's claim type; 22 false fires on true zeros. The prose grammar's measured specificity is 39% (Haiku) / 15% (Sonnet): it fires on "No action is needed." and "Tests: 0 failed", misses "incident-free" | § 5: the library's statement is the guarantee; the prose grammar flags and never triggers enforcement on its own (R1, R3) |

## 2. Reused

| Where | Reused for |
|---|---|
| `semantics/coverage/absent.ts · absent`; `ledger.ts · coverage`; `semantics/described.ts · describedResult` | the only doors a tool returns through; fields are added, never a fourth door |
| `semantics/coverage/types.ts · CoverageItem`, `DeclaredCoverage` | composed items are `CoverageItem`s with typed fields; the row is the same row |
| `core/agent/stages/toolCalls.ts · declareCoverage` (both boundaries, `declareRaisedAbsence`) | where composition and the dispatch-time refusal check run |
| `integrity/claim-binding/capture.ts · ResultIdentity`, `resultIdentityOf`, `readResultIdentity`; `core/agent/findings/verificationState.ts · reserveResultIdentity` | the ONE result identity a handle maps to (`claim-result/<ns>/<runId>/<ordinal>`), reserved before dispatch — #195 § 3.2's attempt |
| `semantics/coverage/period.ts · periodVerdict`, `PERIOD_VERDICT_CLAUSES`, `PeriodRow`; `tools/declare.ts · ToolPeriod`, `AskChoice.said`; `time/` (the leg's clock) | the period facet; the verdict unchanged; the `said` word lists; the span resolved at dispatch |
| `tools/tools.ts · Tool.argumentsFrom / resultClass / resultColumns / needs` and `defineTool`'s definition-time checks; `core/agent/AgentBuilder.ts · tool` (registration); `mcp/toolExtras.ts` | the precedent for `Tool.search`; the row's id column; the credential door; registration-time checks; the `_meta` carrier |
| `semantics/coverage/evidence.ts · absenceEvidenceProjection`; `coverage/read.ts · servedToModel` | what grounds; what the model is served |
| `semantics/check.ts · checkSemantics`; `semantics/coverage/refusal.ts · refusal`; `tools/toolArgsValidation.ts`; `semantics/toolOutcome.ts · ToolResultStatus` | the gate the rules join; the library's refusal sentences, pinned; `partial`, `invalid`, `denied` as statuses |
| `core/agent/emptiness.ts · readEmptiness`; `answer-validation/toolLedger.ts · ledgerAtCheck`; `core/Agent.ts` (the ledger armed by `answerValidation`) | what a call returned; whether it ran; who keeps the ledger |
| `core/agent/assessment/assess.ts · assessAnswer`; `reasons.ts · REASONS` | two reasons join: `declaration-overclaimed` (layer 3), `claim-exceeds-search` (layer 4) |
| `answer-validation/agentChecks.ts`, `validate.ts · executeAnswerValidation`, `stages/answerValidation.ts · agentRowsFor`; `stages/prepareFinal.ts · withheldByValidation`; `hosting/refusalStatus.ts` | the typed row's door; draft tokens held, a withheld draft kept out of history and memory, 422, `RUN_ERROR` |
| `integrity/unsupported-claim/delivered.ts · judgeDeliveredClaim`; `evaluate.ts · compareClaimValues`; `core/agent/evidence/recovery.ts · buildEvidenceRecovery` | the sibling kind's laws; the one value normalization; the no-tools correction turn's shape |
| `adapters/llm/GeminiProvider.ts · isRealId` | why a provider call id can never be cited: one provider shows the model none |
| `tools/normalize.ts · normalizeToken`, `tokenize`; `lib/saidByPerson.ts · isSaidByPerson` | one spelling; the turn's start |
| `core/agent/findings/ledger.ts · recordFindings`, `types.ts · FindingsRow` | the prose finding row |
| `bench/answer/labels.mjs`, `metrics.mjs`, `cases.mjs`, `RULE.md`; `test/core/agent/assessment/fold-real-record.test.ts` | the phrase packs move into the library; the protocol; replaying real records |
| `honest-answers/study/rq3-standing/standing.mjs`, `entities.json`; `design-v1.md` § Case bank | the 21 cases and the 819 + 72 recorded replies the detector is replayed against (tuning only, § 7) |

New: a declaration of what a search is made of; a typed unknown name; a declaration rule pack; a
typed negative claim that cites by handle; a statement composer and its delivery; a prose detector
with notes; a read-only effect declaration.

## 3. Part 1 — coverage generated by code

### 3.1 The declaration — `Tool.search`, once per local tool

```ts
const listIncidents = defineTool({
  name: 'list_incidents',
  description: 'Open incidents for one service',
  inputSchema: {
    type: 'object',
    properties: {
      service: { type: 'string' }, severity: { type: 'string' }, window: { type: 'string' },
      limit: { type: 'integer' }, format: { type: 'string' },
    },
    required: ['service'],
  },
  period: { argument: 'window', spelling: 'lookback', retention: '30d' },      // as today
  effects: 'read',                                                             // R6: this tool changes nothing
  search: {
    source: { what: 'the incident store', said: ['the incident store', 'the store'] },
    subject: { what: 'incidents', said: ['incident', 'incidents'] },
    fixed: [{ name: 'status', value: 'open', said: ['open'] }],                  // built in: part of the search's scope
    arguments: [                                                                 // EVERY input property, classified
      { name: 'service', role: 'population' },
      { name: 'severity', role: 'filter', whenOmitted: { any: true },            // omitted = no narrowing
        said: { critical: ['critical', 'sev1'] } },
      { name: 'window', role: 'period', whenOmitted: '2h' },                     // a default: composed as if sent
      { name: 'limit', role: 'cap', whenOmitted: 200 },
      { name: 'format', role: 'inert' },
    ],
    complete: 'within-arguments',                                                // the tool's statement; absent = never
    gaps: [{ what: 'incidents filed by email', why: 'they never enter the store', bears: 'source' }],
  },
  execute: async ({ service, severity, window = '2h', limit = 200 }) => {
    const read = await store.incidents({ service, severity, window, limit, status: 'open' });
    return read.rows.length
      ? describedResult({ facts: read.rows, provenance: read.provenance, period: read.period,
                          paging: { next: null },
                          resolved: [{ argument: 'service', id: service, name: read.serviceName, aliases: read.aliases }] })
      : absent({ what: `open incidents on ${service}`, checked: 'declared', period: read.period });
  },
});
```

- **Roles**: `population` (which rows — one facet per value sent; a list argument gives one per
  item), `filter`, `period` (the one `Tool.period` names), `source` (the call picks the store: a
  sent value REPLACES the declared `source` in the row, and the declared `source.said` words apply
  only when the sent value is the declared default), `query` / `match` (a free-text or fuzzy
  argument: the search's population is "what matched", so a miss means nothing MATCHED, and the
  row carries a `match` gap bearing on `population`; stated as "for the query `…`"), `cap`,
  `page`, `inert` (changes bytes, not ground).
- **`whenOmitted` has two typed forms.** A VALUE is the default `execute` applies, composed as if
  sent — a default that lives inside `execute` MUST be declared here, or the omitted argument is a
  bearing gap. `{ any: true }` says omission narrows nothing. No third form. **An unsent argument
  of ANY role — `period` and `source` included — with no `whenOmitted` is a bearing gap.**
- **`fixed`** names qualifiers the tool always applies. They are part of the search's scope and
  appear in every statement the library writes.
- **`limits`**: `{ cap: <n> | 'unknown' }` declares a server-side cap no input property carries
  (a result at the cap, or `'unknown'`, bears on `complete`); `{ byCredential: true }` declares
  that the read sees only what the caller's credential may see — a `scope` gap bearing on
  `population`, stated as "within what the caller may see". **`ranking: 'approximate'`** (a vector
  or fuzzy search) means the search can never be complete: `complete` is refused beside it.
- **`effects: 'read'`** (R6) says the tool changes nothing. Only an APP-declared `effects:
  'read'` — written in `defineTool`, on a LOCAL tool — exempts a call from write invalidation;
  tool metadata, MCP annotations and a remote `readOnlyHint` never do. It feeds `superseded-by-write` (§ 5.1): a tool declaring
  neither `effects: 'read'` nor `search` may write. #197's repair turn keeps offering NO tools —
  its decision 10 stays "offer none" — and this declaration changes nothing there.
- **Words.** The `said` lists (the `AskChoice.said` precedent) are the ONLY vocabulary by which a
  PROSE sentence is matched to the source, the subject, a fixed qualifier or a filter value
  (§ 5.2); `resolved.aliases` do the same for the population value THE CALL WAS SENT FOR, and for
  no other entity. Compared under `compareClaimValues` (NFC, trimmed, the case rule); token shape
  decides nothing. `fixed.said` and `subject.said` stay separate (`said-overlap` lint);
  `source.said` words are listed by the gate for review and never disarm `among`'s gap. A typed
  claim uses none of these words.
- **`gaps`** are build-time constants, each with `why` and the facet it `bears` on — `source`,
  `population`, `period`, or `{ filter: 'severity', values: ['sev1'] }`.
- **Text that can reach a statement is REFUSED, an error** (a new API, so no consumer breaks):
  `source.what`, `subject.what`, a `fixed` value, a gap's `what` or `why` that is multi-line, over
  120 characters, or instructs. Refused at `defineTool` AND again at registration
  (`AgentBuilder.tool`, against the registered schema and `period`; a `ToolProvider`'s tools at
  list time, by name) — the second door catches a declaration built after `defineTool` or carried
  over MCP.
- `defineTool` and registration also refuse an unclassified or unknown property, `gaps` without
  `why` or `bears`, `fixed` without `said`, a `whenOmitted` of any other shape, `complete` beside
  `ranking: 'approximate'`. Only `complete: 'within-arguments'` lets a read establish a
  completeness claim: complete for the population, filters and period in effect, when no cap was
  reached, no page was open and the status was not `partial`. Silence about gaps is not
  completeness.
- The author writes the search once. `absent({ what, checked: 'declared' })` satisfies the mint
  rule (a non-empty `checked`) with a literal that says the tool declared it; a hand-written list
  beside it is refused. A `describedResult()` or `coverage()` from a `search` tool composes the
  same way. The declaration rides MCP's `_meta` bag like `argumentsFrom` (`mcp/toolExtras.ts`);
  § 3.4 says what a remote declaration may do.

### 3.2 What the funnel composes

`declareCoverage` is handed the arguments in effect (after the inputs layer's fill and any
before-tool rewrite; declared defaults composed as if sent), the tool, the result identity the
runtime reserved before dispatch (`verificationState.ts · reserveResultIdentity`), and the turn's
next handle. The row:

```jsonc
{ "kind": "absence", "toolName": "list_incidents", "toolCallId": "c1", "iteration": 1, "composed": "local",
  "resultId": "claim-result/ns/run-7/3", "handle": "r3",
  "lookedFor": "open incidents on payments",
  "checked": [
    { "what": "the incident store", "facet": "source", "from": "tool" },
    { "what": "status: open", "facet": "filter", "argument": "status", "value": "open", "from": "fixed" },
    { "what": "service: payments", "facet": "population", "argument": "service", "value": "payments", "from": "call",
      "resolved": { "id": "payments", "name": "Payments", "aliases": ["pay-svc"] } },
    { "what": "severity: any", "facet": "filter", "argument": "severity", "any": true, "from": "default" },
    { "what": "window: 2h", "facet": "period", "argument": "window", "value": "2h", "from": "default",
      "span": { "from": "…T08:00Z", "to": "…T10:00Z" } }
  ],
  "complete": true,
  "gaps": [ { "kind": "scope", "what": "incidents filed by email", "why": "they never enter the store", "bears": "source" } ],
  "period": { "queried": { "from": "…T08:00Z", "to": "…T10:00Z" }, "held": { "from": "…", "to": "…" } } }
```

- `CoverageItem` gains `facet`, `argument`, `value` or `any`, `from` (`call` · `default` · `fixed`
  · `host` · `result` · `tool`), `resolved` and, on a period facet, `span` — a relative window
  resolved to instants AT DISPATCH, on the leg's clock (#199 B1), the span every key uses;
  `DeclaredCoverage` gains `resultId`, `handle`, `composed`, `complete` and `gaps`.
- **Host-filled arguments.** An argument the host fills from the run's identity composes as a
  filter in effect, named by its identity key (`from: 'host'`, `value` by reference
  `{ identity: 'tenant' }` — never the value itself). A credential-filled argument (`needs`,
  `ctx.credential`) is never composed.
- **Gaps are typed, each naming the facet it bears on**: `argument-unsent`, `cap-reached`,
  `paged`, `partial` (facet `completeness`), `match` (a `query`/`match` argument; `population`),
  `credential-limited` (`population`), `period`, `scope`, `prose` (a hand-written `notChecked`,
  no facet). `complete` is true only under `'within-arguments'` with no `argument-unsent` and no
  `completeness` gap; a first page is complete only with `paging: { next: null }`.
- **What the model is served**: the typed fields and the one static note; the period clause when
  the verdict is not `covered`; and, while `.negativeClaims()` is armed, the read's HANDLE (`r3`)
  as one key beside the result — the only thing a typed claim may cite (R5). No new sentence.
- **What grounds**: a composed `value` is withheld from evidence (the `looked_for` rule applied to
  one field kind); constants and result facts ground; a handle never grounds.

### 3.3 A name that resolves to nothing — `absent({ among })`

```ts
if (!array) return absent({
  what: array_id,
  among: { argument: 'array_id', source: inventory.source, measuredAt: inventory.measuredAt,
           count: inventory.names.length, partial: inventory.truncated },
});
```

The mint composes `checked: [{ facet: 'names', count, source, from: 'result' }]`, keeps
`looked_for` as the name (withheld from evidence, as today), and ADDS a gap the author cannot
remove: `{ kind: 'scope', what: 'names outside <source>', bears: 'source' }`. A typed `not-found`
claim citing this read is stated by the library WITH that gap, so c6's "X is not in your estate"
is never written. The only opt-out is `authoritative: { why }`; no `source.said` word ever
disarms it; the gate lists every `authoritative` use. **`among` serves the count and the source
only — no name list.** Served names are HELD OUT of PR 1 (#198): the reviews showed that a list of
the 20 nearest names acts as an inventory listing — it invites an answer about a near name,
carries whatever text the inventory holds, and ranks distinct serials as equal. Whether any list
ever ships is § 7's near-match arm's to decide, and if it does it is at most three near matches
(≤ 2 edits or ≤ 25% of the length under NFC, case fold and dash folding — never the evidence
gate's number conversion, since `000197900456` and `197900456` are different serials), quoted,
under a key that carries the source and never the word "known", and an answer whose entity came
only from that list is marked contingent, or asked. Two more rules from the review of PR 1:
`among.partial: true` — the inventory read was truncated or paged — composes a `completeness` gap
("the list of names was cut short"), distinct from "names outside `<source>`"; a `measuredAt`
that parses as an ISO instant (`time/instant.ts · instantOf`, lenient) gives the statement a
staleness note ("read 09:14Z, 3 h before this answer"), and one that does not parse is quoted as
written, never guessed. A schema-malformed value is still a refusal before dispatch
(`tools/toolArgsValidation.ts`); a well-formed unknown value is never one.

### 3.4 Trust, events and laws

- **Compose only from local first-party tools.** A `search` that arrived over MCP or from a
  `ToolProvider` composes a row marked `composed: 'remote'`: it establishes NOTHING and reads
  `coverage-unverified`. No allow-list in this program (§ 9).
- **Composition can only under-claim — relative to a TRUE declaration.** A facet enters `checked`
  from exactly five places: a value the call sent, a declared default composed as if sent, a
  declared fixed qualifier, the declared (or sent) source, a host-filled identity key. Every
  classified argument not covered by the first three is a bearing gap; a cap, a page, a `partial`
  status, a `query`, a credential limit or approximate ranking is a bearing gap unless the result
  says otherwise. A `from: 'result'` fact can only NARROW or add a gap. So the composed scope is
  never wider than what the declaration and the arguments say. A declaration that misdescribes
  the query is the trusted base, said out loud (§ 6): the law holds relative to it, not to the
  backend.
- **Composed values ride no event, in any mode.** A `search` tool's `tools.absent` /
  `tools.coverage_declared` carry each facet as a reference `{ toolCallId, argument }` and the
  constants' `what`; the values live on the committed row, under the run's redaction policy.
  `lookedFor` and `among`'s value stay as the tool wrote them while `.negativeClaims()` is unarmed
  and become references under the arm. No name list is served or rides an event in this
  program (§ 3.3). The statements
  (§ 5.1) travel on `turn_end` beside `finalContent` and on no other event.
- A typed field is never an instruction. A fact the tool returns is the tool's claim, said out
  loud, checked where § 4 can.
- A tool with no `search`, no `among` and no `effects` composes nothing and changes nothing: rows,
  events and blocks are today's bytes (`test/core/tools/reference/`). An app that uses none of
  the new fields gets no new build warning and meets none of the new errors.

## 4. Part 2 — the declaration overclaim check

One pure rule pack, `semantics/overclaim.ts` (the `tool-lint/rules.ts` shape). Where each rule runs:

| Code | Rule | Doors |
|---|---|---|
| `refusal-asserts-absence` | a not-read result (`invalid`, `denied`, a thrown refusal, a ceiling refusal) carries no `af_absent`, no name list, and no non-existence sentence under the § 5.2 grammar | mint (the library's own sentences pinned by test); `check:semantics`; **dispatch, when `'negative-claims'` is armed** — c6's refusal is marked at run time on the committed row (`overclaim: [...]`), and the fold reads `declaration-overclaimed` |
| `absence-asserts-wrongness` | an absence's `what`, `why`, `tryInstead` or extra key calls the input wrong | `check:semantics` |
| `names-count-mismatch` | `among.count` disagrees with the names, or the k shown exceed `count` | mint; dispatch when armed |
| `unclassified-argument`, `gaps-without-bears`, `fixed-without-said`, `checked-beside-declared`, `complete-beside-approximate`, `statement-text-refused`, `effects-on-remote` | a `search`, an `effects` or a declaration the mint cannot honour | `defineTool` and registration (errors); mint |
| `authoritative-names`, `source-said` (review lists), `said-overlap`, `declaration-instructs` on text that cannot reach a statement, `hint-names-unregistered-tool` | review items | `check:semantics` warnings; build warning |

`check:semantics` gains the warnings as WARNINGS by default; errors only under `--strict` or
`rules: ['overclaim']`, so no consumer's CI breaks on upgrade. Beyond the refusal check and the
`among` count, no rule runs at dispatch in this program. A dispatch finding is read, never
repaired: the result reaches the model as written, the row carries the codes, one dev warning per
tool.

## 5. Part 3 — the delivery check for negative claims

One checker, `integrity/negative-claim/`. Two doors with different powers. **Under the arm every
established typed claim is delivered as the library's statement in every mode; no mode clears a
typed claim without delivering its statement (R1).** The app's one choice, `unestablished`,
decides only a claim the record does NOT establish.

| Door | Claim comes from | Power |
|---|---|---|
| **typed** — a citation the model fills, declared by the app | § 5.1 | an `agentChecks: ['negative-claims']` row; the delivered `negatives` field is the library's; `unestablished: 'withhold'` withholds the answer, `'state-searched'` delivers the statement of what was searched |
| **prose** — the detector over the answer's strings | § 5.2 | a committed finding row, the fold reads `claim-exceeds-search` (not sure), one event, notes. Never a withhold unless `strictProse: true`, which § 7's gates must open |

### 5.1 The typed claim is a citation — the library states, the model points

```ts
negatives: [{ kind: 'none', about: 'payments', restsOn: ['r3'] }]                      // the scope is r3's
negatives: [{ kind: 'not-found', about: 'SHPRSTPRNCL003', restsOn: ['r5'] }]           // an `among` miss
negatives: [{ kind: 'complete', about: 'payments', restsOn: ['r1', 'r2'] }]            // "the rows read are all of them"
```

**The shape:** `{ kind: 'none' | 'not-found' | 'complete', about: <the entity as sent>, restsOn:
['r<n>', …] }`. `about` is REQUIRED (R2). `restsOn` entries are SHORT HANDLES `r1…rn`, numbered
per turn in dispatch order and served beside each result (R5); the library maps each to its own
`ResultIdentity` (`claim-result/<ns>/<runId>/<ordinal>`, `integrity/claim-binding/capture.ts`,
reserved before dispatch) on the committed row. Never a provider call id: providers reuse them
across iterations, branches, legs and turns, and Gemini shows the model none
(`GeminiProvider · isRealId`); #195 rules that provider call ids never select. The schema the
library serves for the field carries `pattern: '^r[1-9][0-9]{0,3}$'` on each entry. A citation
error — an unknown handle, one from another turn or another leg (every `run()` and `resume()`
mints a fresh `runId`), a pattern miss — gets ONE correction turn with NO tools that names the
valid handles and their tools, then `citation-unresolved` / `stale-turn`.

The model writes no scope word: no subject, no source, no qualifier, no window. The claim's scope IS
the composed scope of the cited reads, and the library writes the statement from their rows.
`about` must equal a population value of every cited read, by `resolved.id` or an alias
(`about-mismatch` otherwise). Binding is by handle; `about` is what the claim is ABOUT, and R2
reads it:

**Establishing a typed claim.** Every cited read must be of this run leg, outcome `ok`, with a
`composed: 'local'` row. **`about` must resolve inside the app's TRUSTED context**: the
host-filled identity filters composed on the cited reads (tenant, customer, order — § 3.2). A
claim about an entity outside that context, or resting on a read not scoped to the caller, is not
established (`outside-trusted-context`). By kind: `none` needs each cited read `declared-absent` and not an `among`
miss (`kind-mismatch`); `not-found` needs an `among` absence; `complete` needs each cited read
`complete: true`. **A gap never withholds a typed claim — it is stated.** What withholds, all
monotone, all over the composed executed scope (§ 5.4's two conditions):

- `contradicted-by-rows` — a cited read's own result returned rows, or another read of the same key did;
- `other-read-has-rows` (R2) — any read of this leg with the same `search.subject` whose
  population includes the `about` entity (by `resolved.id` or alias) returned rows inside the
  claim's scope: rows not provably outside the cited scope (a row is provably outside only when it
  carries the filtered field — a `describedResult` fact or a `resultColumns` column — with a value
  other than the cited one, or a window outside the cited span). This stops citing one empty read
  while another over the same entity found rows. **Known limit (R7):** a read of another subject
  (`get_incident` returning the item; `list_changes(payments)`) is not checked unless that tool's
  `search.subject` covers the entity;
- `superseded-by-write` — any call dispatched after the cited read (a same-batch call counts as
  after) to a tool that is not a read: a read is a `search` tool, the `among` path, or an
  APP-declared `effects: 'read'` on a local tool (R6) — never tool metadata, an MCP annotation or
  a remote `readOnlyHint`; every other tool may write. Counted whatever its outcome — an uncertain
  write may have changed the backend; a call refused before dispatch never ran and does not count;
- `later-read-failed` — a same-key call after the cited success that did not read (a
  failure-then-success still establishes).

**The statement**, from the rows alone (`negative-claim/statement.ts`, fixed templates,
`STATEMENT_VERSION`): one clause per cited read, reads ordered by ordinal; every interpolated value
quoted in backticks, stripped of control characters and newlines, capped at 64 characters plus
"…". "`list_incidents` found no incidents for service: `payments` — status: `open`, any severity,
the incident store, 08:00–10:00Z (held in full); not checked: incidents filed by email." ·
"`get_capacity` did not find `SHPRSTPRNCL003` among the 14 array names in the PowerStore inventory
export (read 09:14Z); not checked: names outside that export." · "`list_incidents` read 3 incidents
for service: `payments` — status: `open`, the incident store, 08:00–10:00Z — `INC-7302`,
`INC-7295`, `INC-7288`; no cap reached, one page." A `complete` statement states the rows READ
(count and, when carried, identities) and never vouches for the model's list. An UNestablished
claim's statement of what was searched says the verdict too: "`list_incidents` read 3 incidents
for service: `payments` …; the claim of none does not stand."

### 5.2 Prose — a fixed grammar, flags only

`negative-claim/phrases.ts` holds three closed packs (`NEGATIVE_CLAIM_PHRASES_VERSION`, hashed):
non-existence, completeness in a frame, and unbounded words; an app may add phrases as data.
`detect.ts`: Unicode-aware; language-detecting over a closed stop-word set; Markdown-aware (a
table row and a list item are units; code is noted `in-code-block`); clauses split at "but /
however / except / although"; each hit records `span`, `phraseId`, `packVersion`, nothing of the
text. **A negative counts only when it is DATA-ANCHORED (R3):** an existence or absence predicate
about a noun that is one of the run's searched subjects (`subject.said`), a sent value, a
`resolved` name or alias, or a declared `said` word — never bare "no", "none", "No action is
needed." or "Tests: 0 failed". **A non-English answer gets no repeat check**, a
`language-unsupported` note, and never a withhold by itself.

**Hedges are not scope**; a marker scopes only the dimension it names, through a resolved call's
declared words. **Resolve and containment, as notes** (unchanged from revision 4): a prose claim
resolves through `resolved` values and `source.said` words; the checker notes
`entity-unresolved`, `subject-unmatched`, `scope-wider`, `coverage-gap`, `cap-reached`, `paged`,
`partial`, `match`, `credential-limited`, `empty-undeclared`, `clarify-open`, `period-*`,
`call-not-read`, `declaration-overclaimed`, `rows-undecided`, `gap-relevance-unknown`. None
withholds. Natural prose true zeros mostly read `scope-wider`; that is a note, and the fold's
layer-3 rows say what was searched. **The prose path keeps its own ledger**: `.negativeClaims`
arms `toolCallLedger` as `answerValidation` does (`core/Agent.ts`).

### 5.3 Readings — keys are per LEG, not per turn

A reading's key is the row's composed executed scope (§ 5.4), with a relative window keyed by the
`span` resolved AT DISPATCH on the leg's clock, never by the result's `period.queried`; a retry
after a 503 in the same leg is the same key. Keys, handles' validity and `superseded-by-write` are
scoped to the run LEG (one `runId`): a turn that spans a pause is two legs, and a read before the
pause cited after it is `stale-turn` (#200 #5). The `turn` stamp on rows serves the fold, never a
key. Within one key a later read replaces only an UNREAD outcome; two reads that both read and
disagree contradict a typed claim citing either and are `readings-disagree` for prose. Adding a
key never relaxes a verdict (the #197 monotonicity property). The departure from #197 is
narrower than its contract because a key is a search the library composed, not a row any tool
could forge.

### 5.4 Judge — the row

Typed rows `agent:negative-claims:<field>#<n>` carry `path`, the claim index, the verdict code, the
tool names and the cited identities; prose finding rows (`FindingsRow` kind `negative-claim`)
carry `field`, `span`, `phraseId`, `packVersion`, the note codes and the resolved call ids. Never a
value or a sentence.

| Typed verdict | Disposition |
|---|---|
| no claim; or established (its statement delivered) | `not-applicable` — established clears the claim, never verifies the answer (no agent row is `checked-pass`) |
| `contradicted-by-rows`; `other-read-has-rows`; `search-incomplete` (`complete` cited on a read that is not `complete`); `superseded-by-write`; `later-read-failed`; `prose-repeats-claim` (only under `strictProse`) | `checked-fail` |
| `citation-unresolved` (after the correction turn); `cited-call-undeclared`; `coverage-unverified` (a `composed: 'remote'` row); `call-not-read`; `kind-mismatch`; `about-mismatch`; `outside-trusted-context` (the entity is outside the host-filled identity filters of the cited reads, or a cited read is not scoped to the caller); `record-incomplete`; `stale-turn` | `unreachable` |

Two conditions the codes share, stated once:

- **"Same search" and "same key"** — in `later-read-failed`, `readings-disagree`, the same-key
  contradiction and `other-read-has-rows`' scope test — mean the COMPOSED executed scope of the
  row: the tool, every filter in effect including `whenOmitted` defaults, the `fixed` qualifiers,
  host-filled identity filters by reference, and the span resolved at dispatch. Never the tool
  name alone, and never the model-visible arguments alone.
- **`superseded-by-write`** counts every non-read call DISPATCHED after the cited read, whatever
  its outcome — success, error, timeout, abort, `partial`. A call refused before dispatch does
  not count. A non-read call in the same parallel batch as the cited read counts as after it.

`validate.ts` makes a `checked-fail` row a `failed` report and an `unreachable` row an
`unverified` one. The fold reads a failed typed row, or a prose finding, as
`claim-exceeds-search` (layer 4, not sure) and an unreachable typed row as `check-unreachable`.

### 5.5 What the person sees

The delivery row is #195 § 3.5's: `as-checked`, `recorded`, `fallback`.

- **Every mode, every established claim:** the delivered `negatives` field is the LIBRARY's —
  each entry `{ kind, about, restsOn, statement, delivery: 'record-composed', version }` — on the
  answer and on `turn_end.answerNegatives`; the app must show the marker beside the sentence. The
  model's citations are replaced by the statements; nothing of the model's reaches the field. The
  actions-taken line rides beside it (#195 § 3.6). **The person and the conversation memory
  receive the SAME library-rendered statement, every gap preserved**: history and memory capture
  the delivered answer with the library's field; the model's draft is neither delivered nor
  remembered.
- **An unestablished claim, `unestablished: 'withhold'` (the default):** the answer is withheld
  whole (`fallback`): `AnswerValidationError`, 422 over a host, `RUN_ERROR` over AG-UI.
- **An unestablished claim, `unestablished: 'state-searched'`:** that entry becomes the statement
  of what WAS searched and what came back (§ 5.1's last example), delivered `recorded`; the report
  stays `failed` for the fold, which reads not-sure; the rest of the answer is the model's.
- **The model's prose (R3):** the detector runs over EVERY string of the answer; a data-anchored
  negative beside a typed claim, or with no citation at all, files a `negative-claim` finding and
  the fold reads not-sure. That is the guarantee's edge: flagged, not exact. Only
  `strictProse: true` — an opt-in § 7's detector gates must open — runs ONE correction turn with
  NO tools (#195 `a627ae8da`, #197 `72b7c3262`; request-only context naming the sentence's field,
  the `buildEvidenceRecovery` shape; counted against the turn's one-extra-call budget), re-runs
  the full check with citations re-validated, and withholds (`prose-repeats-claim`) if a negative
  persists. The reviewers' numbers say why it is opt-in: a grammar with 39% / 15% specificity
  would withhold correct answers and teach rewording.
- **Streaming (R4):** under the arm the final answer is buffered — no draft token is streamed
  (`answerValidation`'s existing suppression) — and a rejected draft never enters history or
  memory (`prepareFinal.ts · withheldByValidation` stops conversation capture and memory writes;
  the correction turn quotes the draft as request-only data).
- **A follow-up turn or a resumed leg** citing an earlier leg's read: a dated note under observe;
  `unreachable: stale-turn` with the date under enforce.

### 5.6 The arm

```ts
Agent.create({ provider, model })
  .tool(listIncidents)
  .outputSchema(IncidentReport)                                  // { summary, incidents, negatives }
  .negativeClaims({ field: 'negatives', tools: ['list_incidents'], unestablished: 'withhold' })
  .answerValidation({ id: 'incident-report', version: '1',
    agentChecks: ['negative-claims'], validate: () => ({ checks: [] }) })
  .build();
```

`build()` refuses `'negative-claims'` without `.negativeClaims()`, a `field` the schema does not
declare, a tool it does not register or that is not local, and `strictProse` without the
`enforceProse` flag. The library serves the field's schema with the handle pattern. An agent that
lists nothing is byte-identical; a prose-only agent (`.negativeClaims({ prose: true })` with no
`.outputSchema()`) files findings from the Route decider, keeps its own ledger, and needs no
validation door. Until § 7's typed gates pass, the docs present typed enforce as available but not
recommended.

## 6. Threat model

| Input | Trust | It cannot |
|---|---|---|
| The model's typed citation | untrusted | widen a scope (it writes none); cite a provider id, another leg's or turn's read, a read that did not read, an undeclared or remote tool, or one with rows; pick an empty read over another with rows for the same entity (R2); hide a gap; inject text into the statement |
| The model's prose | untrusted | be stated by the library; be the enforcement trigger (R1, R3); a flat phrasing the grammar misses is a MISSED flag, measured; a hedge is not scope |
| A value that reaches a statement | untrusted bytes | carry control characters, newlines or length: quoted, stripped, capped at 64 |
| A third-party envelope, `search`, `among` or `readOnlyHint` (MCP, a provider) | untrusted | establish anything; relax `superseded-by-write`; ground its names; forge a composed row, a handle or a result identity — only the local funnel writes them |
| Injected text in a tool result | untrusted | add a row or a fact; it sways the draft, and the draft is checked; it cannot reach history or memory once rejected |
| A buggy local tool: a `search` whose query differs, an undeclared qualifier, cap, credential limit or ranking, a wrong `effects: 'read'`, `complete`, `held`, `resolved` or `paging` | the trusted base, said out loud | be caught except by the consistency rules; the sealed side log and a misreport bench cell are the outside check (#195 § 6) |
| A forged or stale checkpoint; a `resumeOnError` leg | shape-checked | list calls that never ran (`record-incomplete`), or lend another leg's identity (`stale-turn`) |
| A redaction policy keeping out a key the check reads | the app's law | be read around: `record-incomplete`; events carry references, not values |
| A refusal written to persuade | the author's words | reach the model unmarked when the check is armed; the gate flags it before |

Known limit (R7): a contradiction across tools is checked only through `other-read-has-rows`,
and only among reads whose `search.subject` covers the entity. Fail closed: every error, limit,
timeout, unresolved citation, unread or superseded call, remote row or kept-out key is
`unreachable` or `checked-fail`, never `not-applicable`. The check vouches for agreement with the
record of the search, not for truth.

## 7. Measurement

**Frozen first, in `bench/negative/RULE.md`:** the system prompt, the output schema (with the
handle pattern), the output strategy, the grammar's hash and version, `STATEMENT_VERSION`, every
case's declarations, the case split, the floors and the gates — before any label or paid call.

**A fresh case bank.** c3 and c6 shaped this design, and the study's 21 cases shaped its
revisions, so they cannot be held out honestly. They become the TUNING set only (with the Sonnet
replies and the PROMPT arm). The held-out set is a NEW bank of ≥ 24 cases, written by a person who
has not read any study reply, with the tools' `search`/`among`/`effects` declarations authored
from the schemas alone, blind to prior replies: ≥ 8 true zeros over a complete search (one with an
irrelevant gap on another call, one narrow-then-wide pair, one with a source gap), ≥ 6 false
non-existence cases (undeclared empty, partial window, a refused name, an `among` miss), ≥ 4
completeness cases (a cap, a page, `partial`), ≥ 3 contradiction cases (another read over the same
entity with rows; a cross-subject read, the R7 limit), ≥ 3 superseded cases (a write after the
read; a non-`search` lookup after it). Every number is reported per split and per model; gates
are read on the fresh bank only.

**Raters (decided by the owner, 2026-10-23).** Two AI raters label EVERY sentence, with the tool
results shown and never seeing the grammar or the statements. If a non-Anthropic rater is
available (an owner-provided key) it is one of the two; otherwise both are Anthropic models of a
different model than the agent under test, and the results state that limitation. The OWNER
adjudicates every sentence where the two disagree (≈ 80, later). There is no second human. The
results say plainly that they rest on model raters, with owner adjudication of disagreements
only. Citation CORRECTNESS is one of those labels: for each typed claim, which read is the right
one, labelled with the results shown.

**Scripted (mock provider), zero tolerance.** Every typed verdict and prose note; handle mapping
(a Gemini-style missing id, another leg's handle, a pattern miss, the correction turn naming the
valid handles); R2 over same-subject reads with and without provably-outside rows; the statement
composer and its sanitising; `superseded-by-write` with `effects: 'read'`, a `search` tool, an
undeclared tool, a same-batch call, a refused-before-dispatch call; leg-vs-turn keying across a
pause; the dispatch-time span; registration-time refusals; `ranking: 'approximate'`, `query`,
`byCredential`; streaming buffered and a rejected draft absent from history and memory; the
`state-searched` statement; `strictProse` refused without the flag; byte identity for every
unarmed agent; in-run standing = read-after fold.

**Free replay** (tuning only): the detector over the 819 + 72 recorded replies and the 21 cases,
precision and recall against the sentence labels, the "withhold every detected flat claim"
ablation beside it. It tunes the grammar; it gates nothing.

**Paid arms, on the fresh bank** — the enforce path cannot be replayed, so it is run:
(a) OBSERVE: Haiku 4.5, 24 × 10 = 240 replies; Sonnet 4.6, 12 × 6 = 72. (b) ENFORCE, typed, with
the correction turn: Haiku 24 × 10 = 240 (+ corrections); Sonnet 12 × 6 = 72. (c) A LONG-CONTEXT
TWO-TURN cell: Haiku, 8 cases × 5, the second turn citing after a first turn's reads and a long
first answer. Dispositions of (a) are computed offline; (b) and (c) record delivery as it
happened. Measured: citation validity and CORRECTNESS, the field-drop rate (the model omits
`negatives` where the truth is a negative), the rewording/evasion rate (a data-anchored negative in
prose beside a typed claim, before and after a correction turn), false holds, usefulness (a
5-point rating of the delivered answer against the truth by the two AI raters, the owner
adjudicating disagreements), tokens and latency per arm. (d) An `among` NEAR-MATCH arm, on the fresh bank's name-miss cases: two arms, `count`
and source only (what PR 1 ships) against a "did you mean?" list of at most three near matches
(≤ 2 edits or ≤ 25% of the length under NFC, case fold and dash folding; quoted; under a key that
carries the source, never "known"; an answer whose entity came only from that list marked
contingent, or asked); Haiku, 6 cases × 10 × 2 arms = 120 replies (≈ $0.30). Measured: the flat
"not in the estate" rate, the SUBSTITUTION rate (an answer about a near name as if it were the
asked one), the ask rate, and the typed `not-found` citation rate, per arm. Names are served only
if the near-match arm passes its gate: substitution ≤ 0.05 (upper ≤ 0.15) with no rise in the
flat rate; until then no list ships. **Cost ≈ $4.30** (Haiku ≈ $2.20 across the four cells,
Sonnet ≈ $2.10), **cap $4.50 — APPROVED by the owner on 2026-10-23, the full plan: all four
cells at their stated sizes, no fallback.**

**Gates — on the fresh bank, case-level exact (Clopper–Pearson) bounds, floors in `rule.mjs`.**
The populations are disjoint so no two gates can conflict: a FALSE HOLD is a true-zero case's
claim with a CORRECT citation that was withheld or `unreachable`; a wrong citation is a citation
failure, never a false hold. False holds ≤ 0.02 (upper ≤ 0.10) over ≥ 8 cases and ≥ 80 replies;
citation validity ≥ 0.90 and correctness ≥ 0.85 per model (lower ≥ 0.80 / ≥ 0.75); missed
contradictions (a `none` delivered where a same-subject read over the entity had rows) 0 in the
scripted suite and ≤ 0.02 (upper ≤ 0.10) paid; field-drop ≤ 0.10; rewording after the correction
turn ≤ 0.05 (reported; it gates `strictProse` only); the detector's sensitivity ≥ 0.85 and
specificity ≥ 0.95 (lower ≥ 0.70 / ≥ 0.85) on the fresh bank's prose — the gate `enforceProse` and
`strictProse` must pass; usefulness not below the `off` arm by more than 0.3; tokens ≤ 1.15 × and
latency ≤ 1.3 × the `off` arm. Typed enforce becomes "recommended" only when the typed gates pass.

## 8. What ships, in order

| PR | Ships | Off = byte-identical |
|---|---|---|
| 1 · the c6 fix (in flight) | `absent({ among })` serving the count and the source only — served names HELD OUT (§ 3.3) — with the irremovable gap (`bears: 'source'`), `partial`, the staleness note and `authoritative`; refusal-sentence pins; the two `check:semantics` warnings | yes |
| 2 · `Tool.search` (in flight) | classified `arguments` for every role incl. `query`/`match`, the two `whenOmitted` forms, `fixed`, `subject`, `said` words, a sent `source` replacing the declared one, `limits.cap` / `limits.byCredential`, `ranking`, `complete`, typed gaps with `bears`, host-filled arguments, `resolved` bound to the sent entity, `paging`, `checked: 'declared'`, local-only composition, references on events, `resultId` and `handle` on the row, the dispatch-time `span`, `statement-text-refused` at `defineTool` AND registration, `effects: 'read'` (local only), the under-claim law "relative to a true declaration" | yes |
| 3 · the checker (in flight) | `integrity/negative-claim/`: phrases, the data-anchored detector, the prose notes, the typed citation's rules and verdicts, `other-read-has-rows`, the statement composer (incl. the state-searched form), the leg-scoped readings key; replayed free against the recorded replies | — |
| 4 · the wiring | `.negativeClaims({ field, tools, unestablished, strictProse?, prose? })`, handles served beside results and mapped to identities, the served schema pattern, the `'negative-claims'` row, the library's `negatives` field delivered in every mode with the marker and the actions line, the `fallback` / `recorded` / `as-checked` delivery row, the no-tools correction turn for citation errors (and for `strictProse`), buffering and the rejected draft kept out of history and memory, `turn_end.answerNegatives` with `STATEMENT_VERSION`, the fold reason, the dispatch-time refusal check under the arm, the prose findings and their ledger; docs: "available, not recommended" until § 7's typed gates pass | yes |
| 5 · the paid bench | `bench/negative/`: the fresh bank, the three paid cells, the raters' plan; `enforceProse` / `strictProse` open only if the detector gates pass; typed enforce "recommended" only if the typed gates pass | — |

4 needs 1–3; 5 after 4. Deferred: the dispatch-time rule pack beyond the refusal and `among`
checks; a forced fresh read on a stale turn; a hash allow-list for remote declarations and the
catalog's MCP `outputSchema`, annotations and definition digest that would carry it. Cut: a
library-written scoped form for prose; model-written scope words in a typed claim; the prose
grammar as an enforcement trigger.

## 9. Decisions — DECIDED (owner, 2026-10-22; revision 6's R1–R7 under "decide for the library", 2026-10-23)

1. **Names** as proposed, plus `effects`, `handle`, `unestablished` (`withhold` | `state-searched`),
   `strictProse`, `limits.byCredential`, `ranking`, the `query`/`match` roles.
2. **`complete` absent = never complete.** Why: silence must never read as completeness.
3. **Readings rule: not "latest settles"**; keys are the composed executed scope, per LEG; a
   relative window keys by its span resolved at dispatch on the leg's clock. Why: a retry must not
   withhold a correct "none"; a real disagreement is never settled by order of arrival; a turn
   may span legs.
4. **No served names in this program.** `among` serves the count and the source only; a
   near-match "did you mean?" list (at most three, quoted, under a key that carries the source)
   ships only if § 7's arm passes its gate. Why: the reviews of PR 1 showed a 20-name list acts as
   an inventory listing — it invites answering about a near name, carries injected text, and
   ranks distinct serials as equal — and a default-visible list would also reopen enumeration
   across principals.
5. **Remote declarations: no allow-list now**; a remote row establishes nothing. Why: a field need decides.
6. **Stale turn: `unreachable: stale-turn` with the date.** Why: a withhold that says why.
7. **Typed claims enforced; prose observe-only; library wording for typed claims with the marker;
   the paid bench ≈ $4.30, cap $4.50 — APPROVED (2026-10-23), the full plan of § 7, not the
   fallback.**
8. **`check:semantics`: warnings until a later major**; the new errors touch only the new fields.
9. **A typed negative claim is a CITATION.** Why: a claim that restates scope has nothing to be
   contained in; with citation the statement cannot be wider than the search.
10. **R1 — the guarantee is the library's statement.** Every established typed claim is delivered
    as the library's statement in every mode; `unestablished` decides only a claim the record does
    not establish. Why: three lenses found the same hole — a mode that "clears" a typed claim and
    lets the person read the model's prose guarantees nothing; and a grammar with 39% / 15%
    specificity cannot be an enforcement trigger.
11. **R2 — `about` is required**, and every same-subject read over that entity is checked. Why:
    citing one empty read while another found rows is cherry-picking; the entity makes it checkable.
12. **R3 — prose is flagged, not withheld**, by default; `strictProse` is an opt-in that § 7's
    detector gates must open; the repeat grammar is data-anchored; non-English is never a withhold
    by itself. Why: the measured specificity; a correction turn on a loose grammar teaches rewording.
13. **R4 — buffered delivery; a rejected draft never enters history or memory.** Why: a streamed
    draft is a delivery; a rejected draft in history is served again.
14. **R5 — short handles, mapped by the library.** Why: a 40-character identity is a copy error
    waiting to happen; the map is the library's, so a handle is as trustworthy as the identity.
15. **R6 — `effects: 'read'` on local tools only**; #197's repair turn keeps offering no tools.
    Why: `superseded-by-write` over-withheld on every undeclared lookup; a remote hint is untrusted.
16. **R7 — the cross-tool limit is stated**, not papered over. Why: a check that claims more than
    it does is the failure this design exists to prevent.
17. **Raters (owner, 2026-10-23): two AI raters label every sentence** — tool results shown,
    never the grammar or the statements; a non-Anthropic rater is one of the two when available,
    else two Anthropic raters of a different model than the agent under test, with the limitation
    stated; the owner adjudicates every disagreement (≈ 80, later); no second human. The results
    say plainly that they rest on model raters with owner adjudication of disagreements only.
18. **Three requirements made explicit (the owner's reviewer, 2026-10-23):** `about` resolves
    inside the app's trusted context (the host-filled identity filters on the cited reads), else
    `outside-trusted-context`; only an app-declared `effects: 'read'` in `defineTool` on a local
    tool exempts a call from write invalidation — never metadata, an MCP annotation or a remote
    `readOnlyHint`; the person and the conversation memory receive the same library-rendered
    statement, every gap preserved, and the model's draft is neither delivered nor remembered.

## 10. Considered and rejected

| Proposal | Why not |
|---|---|
| The prose grammar as the enforcement trigger | 39% / 15% specificity; fires on "No action is needed."; a correction turn would teach rewording. It flags |
| A mode that clears a typed claim without delivering its statement | the person then reads the model's prose beside a citation to a billing search — the blocker |
| A typed claim that restates its scope | nothing to contain it in; the model points, the library states |
| Citing a provider call id | reused across iterations, branches, legs and turns; Gemini shows none; #195: never select |
| Binding a typed claim by entity alone, or checking `about` across every tool | `list_changes(payments)` rows would be pulled into a claim about incidents; same-subject reads only (R2, R7) |
| A remote `readOnlyHint` relaxing `superseded-by-write` | untrusted text; local `effects: 'read'` only |
| Generating `search` declarations or evidence profiles at runtime with a model | a declaration is a claim; a remote description is an injection path; a same-typed field mismatch passes every structural check; verification must be deterministic. Kept open: an offline, person-reviewed, digest-pinned authoring helper |
| Holding out the study's cases | c3/c6 shaped the design and the 21 cases shaped its revisions; a fresh bank written blind is the only honest held-out set |
| A fourth result door; token-shape matching; hedges as scope; the person's message or the single call as a binding; a correction turn with tools; a model judge for the claim type; counting every gap of the turn; "latest settles"; a served list of the 20 nearest names (held out of PR 1; at most a gated three-name "did you mean?"); error-level gate rules on upgrade; carrying coverage into the next leg | as in revisions 2–5: each would either guess, trust an untrusted input, or make silence read as knowledge |

## 11. What #199's copy of this note must change

Revision 6 touches: the status and guarantee paragraphs; § 1 row 4 (the grammar's measured
specificity); § 3.1 (the `query`/`match` roles, `limits.byCredential`, `ranking`, `effects:
'read'`, refusals at registration); § 3.2 (`handle`, the dispatch-time `span`, the `match` and
`credential-limited` gaps, the handle served); § 3.4 (the law "relative to a true declaration");
§ 4 (the new error codes); § 5 whole (R1 modes, R2 `about` and `other-read-has-rows`, R3
data-anchored flags and `strictProse`, R4 buffering, R5 handles and the citation correction turn,
R6 `effects`, R7 the limit; `unestablished` replaces `exceeds`; the delivery rows); § 6 (R7, the
hint row); § 7 whole; § 8 (PR 4 and PR 5 rows; PR 2's additions); § 9 (decisions 10–16); § 10.
