# Negative claims, honest by construction — "not found", "none" and "the list is complete"

**Status: design, revision 5 (2026-10-23). Direction and bench approved by the owner; § 9 records
the decisions, the ninth of which — a typed negative claim is a CITATION — simplified part 3.**
Revision 2 followed four lens reviews; revisions 3–5 close verifiers' walks of inputs through the
rules. PR 1, 2 and 3 (§ 8) are in flight. It stacks on PR #197 (`agentChecks`: an agent row can
withhold, never verify) and fits PR #195 (`docs/design/2026-10-exact-claims-mounted.md`: the
runtime binds a claim; the model never names the evidence; provider call ids never select; a
delivery built from the record carries its own mark). Paths are under `src/`; code is cited as
`file · symbol`.

**The goal, in the owner's words.** A reply states something as fact only when the tool results
establish it, and as not-sure otherwise. The guarantee comes from code, not from the model obeying
text.

**The decision in one paragraph.** Three parts on existing seams, each byte-identical when off.
(1) A local tool declares once what its search is made of — every input argument classified by
role, every default, built-in qualifier and server limit declared, and whether the search is
complete for what it ran with — and the dispatch funnel composes each call's coverage from the
arguments in effect, so a declaration cannot claim more than the search did; a name that resolves
to nothing is a named miss over the known names, with the names outside that list an irremovable
gap. (2) A declaration is a claim, so it is checked like one: a small rule pack at definition, at
the mint and in the `check:semantics` gate; at dispatch only the refusal check, and only when the
delivery check is armed. (3) **The library states negatives; the model only points.** A typed
negative claim cites, by the library's own result identity, the calls it rests on and nothing
else; its scope IS the composed scope of those calls, and the library writes the statement from
their rows, gaps said out loud. The claim cannot be wider than the search by construction. Enforce
withholds when a cited call did not read, returned rows, was overtaken by a wider read with rows or
by a later call, or a completeness claim rests on an incomplete search. A prose detector files
observe rows only.

## 1. What the study found, and what answers it

| The study found (Haiku 4.5, 819 replies; Sonnet 4.6, 72) | Answered by |
|---|---|
| Declared coverage cut flat "X does not exist" replies mainly where the declaration named the exact gap the question fell into (a per-call "the store holds only part of the window": 11/12 → 1/12). A one-sentence prompt instruction changed nothing | § 3: coverage composed from the arguments in effect names the gap by construction; § 5.1: the library's statement says every gap out loud |
| An overclaiming refusal ("No array matches 'X'. Known arrays: … a wrong identifier, not missing data") made replies worse on both models. A pre-check over a known list IS a search | § 3.3: an unresolved name is an absence over the known names, with "names outside the source" a gap the author cannot drop; § 4: a refusal may not assert non-existence |
| Prose instructions and hints rode along; the model never called a hinted tool | § 3: every composed field is data; author prose that instructs is refused where it can reach a statement |
| The registered standing rule failed: text copies, any gap anywhere, a rater's claim type; 22 false fires on true zeros | § 5: structured rows only; a typed claim binds by cited result identity; a gap is stated, never a withhold; a fixed grammar for prose, observe-only |

## 2. Reused

| Where | Reused for |
|---|---|
| `semantics/coverage/absent.ts · absent`; `ledger.ts · coverage`; `semantics/described.ts · describedResult` | the only doors a tool returns through; fields are added, never a fourth door |
| `semantics/coverage/types.ts · CoverageItem`, `DeclaredCoverage` | composed items are `CoverageItem`s with typed fields; the row is the same row |
| `core/agent/stages/toolCalls.ts · declareCoverage` (both boundaries, `declareRaisedAbsence`) | where composition and the dispatch-time refusal check run |
| `integrity/claim-binding/capture.ts · ResultIdentity`, `resultIdentityOf`, `readResultIdentity`; `core/agent/findings/verificationState.ts · reserveResultIdentity` | the ONE result identity a typed claim cites (`claim-result/<ns>/<runId>/<ordinal>`), reserved before dispatch — #195 § 3.2's attempt |
| `semantics/coverage/period.ts · periodVerdict`, `PERIOD_VERDICT_CLAUSES`, `PeriodRow`; `tools/declare.ts · ToolPeriod`, `AskChoice.said`; `time/` (the leg's clock) | the period facet; the verdict unchanged; the `said` word lists; the key of a relative window |
| `tools/tools.ts · Tool.argumentsFrom / resultClass / resultColumns` and `defineTool`'s definition-time checks; `mcp/toolExtras.ts` | the precedent for `Tool.search`; the row's id column; the `_meta` carrier |
| `semantics/coverage/evidence.ts · absenceEvidenceProjection`; `coverage/read.ts · servedToModel` | what grounds; what the model is served |
| `semantics/check.ts · checkSemantics`; `semantics/coverage/refusal.ts · refusal`; `tools/toolArgsValidation.ts`; `semantics/toolOutcome.ts · ToolResultStatus` | the gate the rules join; the library's refusal sentences, pinned; `partial`, `invalid`, `denied` as statuses |
| `core/agent/emptiness.ts · readEmptiness`; `answer-validation/toolLedger.ts · ledgerAtCheck`; `core/Agent.ts` (the ledger armed by `answerValidation`) | what a call returned; whether it ran; who keeps the ledger |
| `core/agent/assessment/assess.ts · assessAnswer`; `reasons.ts · REASONS` | two reasons join: `declaration-overclaimed` (layer 3), `claim-exceeds-search` (layer 4) |
| `answer-validation/agentChecks.ts`, `validate.ts · executeAnswerValidation`, `stages/answerValidation.ts · agentRowsFor`; `stages/prepareFinal.ts · withheldByValidation`; `hosting/refusalStatus.ts` | the typed row's door; the withhold path, 422, `RUN_ERROR` |
| `integrity/unsupported-claim/delivered.ts · judgeDeliveredClaim`; `evaluate.ts · compareClaimValues`; `core/agent/evidence/recovery.ts · buildEvidenceRecovery` | the sibling kind's laws; the one value normalization; the no-tools correction turn's shape |
| `adapters/llm/GeminiProvider.ts · isRealId` | why a provider call id can never be cited: one provider shows the model none |
| `tools/normalize.ts · normalizeToken`, `tokenize`; `lib/saidByPerson.ts · isSaidByPerson` | one spelling; the turn's start |
| `core/agent/findings/ledger.ts · recordFindings`, `types.ts · FindingsRow` | the prose observe row |
| `bench/answer/labels.mjs`, `metrics.mjs`, `cases.mjs`, `RULE.md`; `test/core/agent/assessment/fold-real-record.test.ts` | the phrase packs move into the library; the protocol; replaying real records |
| `honest-answers/study/rq3-standing/standing.mjs`, `entities.json`; `design-v1.md` § Case bank | the 21 cases and the 819 + 72 recorded replies the detector is replayed against |

New: a declaration of what a search is made of; a typed unknown name; a declaration rule pack; a
typed negative claim that cites; a statement composer; a prose detector with containment notes.

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
  only when the sent value is the declared default — a search of `db: 'replica'` never composes
  "the incident store"), `cap`, `page`, `inert` (changes bytes, not ground).
- **`whenOmitted` has two typed forms.** A VALUE is the default `execute` applies, composed as if
  sent — a default that lives inside `execute` (`unresolved_only = true`) MUST be declared here, or
  the omitted argument is a bearing gap. `{ any: true }` says omission narrows nothing. No third
  form. **An unsent argument of ANY role — `period` and `source` included — with no `whenOmitted`
  is a bearing gap.**
- **`fixed`** names qualifiers the tool always applies. They are part of the search's scope and
  appear in every statement the library writes.
- **`limits: { cap: <n> | 'unknown' }`** declares a server-side cap that no input property
  carries; a result at the cap, or a cap of `'unknown'`, bears on `complete`.
- **Words.** The `said` lists (the `AskChoice.said` precedent) are the ONLY vocabulary by which a
  PROSE claim's words are matched to the source, the subject, a fixed qualifier or a filter value
  (§ 5.2); `resolved.aliases` do the same for the population value THE CALL WAS SENT FOR, and for
  no other entity — store data cannot bind another entity's name. Compared under
  `compareClaimValues` (NFC, trimmed, the case rule); token shape decides nothing. `fixed.said`
  and `subject.said` stay separate; a `subject.said` word that repeats a qualifier not in `fixed`
  is linted (`said-overlap`). `source.said` words are listed by the gate for review, like
  `authoritative`, and never disarm `among`'s gap (§ 3.3). A typed claim uses none of these words.
- **`gaps`** are build-time constants, each with `why` and the facet it `bears` on — `source`,
  `population`, `period`, or `{ filter: 'severity', values: ['sev1'] }`, the values the gap
  concerns: a prose claim naming sev1 is exactly what such a gap bears on, not what disarms it.
- **Text that can reach a statement is REFUSED at `defineTool`, an error** (a new API, so no
  consumer breaks): `source.what`, `subject.what`, a `fixed` value, a gap's `what` or `why` that
  is multi-line, over 120 characters, or instructs (the `declaration-instructs` list: "do not",
  "always", "tell the user", "carry these", "report that"). The library's statement is built from
  these words, so they are held to the standard of a sentence the person will read.
- `defineTool` also refuses an unclassified or unknown property, `gaps` without `why` or `bears`,
  `fixed` without `said`, a `whenOmitted` of any other shape (`unclassified-argument` and its
  siblings, the `assertResultCeiling` precedent). Only `complete: 'within-arguments'` lets a call
  establish a completeness claim: complete for the population, filters and period in effect, when
  no cap was reached, no page was open and the status was not `partial`. Silence about gaps is not
  completeness.
- The author writes the search once. `absent({ what, checked: 'declared' })` satisfies the mint
  rule (a non-empty `checked`) with a literal that says the tool declared it; a hand-written list
  beside it is refused. A `describedResult()` or `coverage()` from a `search` tool composes the
  same way. The declaration rides MCP's `_meta` bag like `argumentsFrom` (`mcp/toolExtras.ts`);
  § 3.4 says what a remote declaration may do.

### 3.2 What the funnel composes

`declareCoverage` is handed the arguments in effect (after the inputs layer's fill and any
before-tool rewrite; declared defaults composed as if sent), the tool, and the result identity the
runtime reserved before dispatch (`verificationState.ts · reserveResultIdentity`). The row:

```jsonc
{ "kind": "absence", "toolName": "list_incidents", "toolCallId": "c1", "iteration": 1, "composed": "local",
  "resultId": "claim-result/ns/run-7/3",
  "lookedFor": "open incidents on payments",
  "checked": [
    { "what": "the incident store", "facet": "source", "from": "tool" },
    { "what": "status: open", "facet": "filter", "argument": "status", "value": "open", "from": "fixed" },
    { "what": "service: payments", "facet": "population", "argument": "service", "value": "payments", "from": "call",
      "resolved": { "id": "payments", "name": "Payments", "aliases": ["pay-svc"] } },
    { "what": "severity: any", "facet": "filter", "argument": "severity", "any": true, "from": "default" },
    { "what": "window: 2h", "facet": "period", "argument": "window", "value": "2h", "from": "default" }
  ],
  "complete": true,
  "gaps": [ { "kind": "scope", "what": "incidents filed by email", "why": "they never enter the store", "bears": "source" } ],
  "period": { "queried": { "from": "…T08:00Z", "to": "…T10:00Z" }, "held": { "from": "…", "to": "…" } } }
```

- `CoverageItem` gains `facet`, `argument`, `value` or `any`, `from` (`call` · `default` · `fixed`
  · `host` · `result` · `tool`) and `resolved`; `DeclaredCoverage` gains `resultId`, `composed`,
  `complete` and `gaps`.
- **Host-filled arguments.** An argument the host fills from the run's identity (a tenant, a
  principal, a session scope) composes as a filter in effect, named by its identity key
  (`from: 'host'`, `argument`, `value` by reference `{ identity: 'tenant' }` — never the value
  itself), so the statement can say "within tenant: (the caller's)". A credential-filled argument
  (`needs`, `ctx.credential`) is never composed: it names no ground and must leave no trace.
- **Gaps are typed, each naming the facet it bears on**: `argument-unsent` (any classified
  argument the call did not send with no `whenOmitted`; bears on that argument's facet),
  `cap-reached`, `paged` and `partial` (facet `completeness`: rows ≥ the cap in effect or a
  declared server cap, a cap of `'unknown'`, a page argument sent, a result whose `paging.next` is
  not null, a `page`-role tool whose result declares no `paging`, or a delivered status
  `partial`), `period` (the verdict, the spans), `scope` (the declared constants, with `bears`),
  `prose` (a hand-written `notChecked`, no facet). `complete` is true only under
  `'within-arguments'` with no `argument-unsent` and no `completeness` gap; a first page is
  complete only with `paging: { next: null }`.
- **What the model is served**: the typed fields and the one static note; the period clause when
  the verdict is not `covered`; and, while `.negativeClaims()` is armed, the result identity as
  one key beside the result (`result_id`), the form #195's mounted design hands the attempt's id —
  the only handle a typed claim may cite. No new sentence.
- **What grounds**: a composed `value` quotes the call and is withheld from evidence
  (`coverage/evidence.ts`, the `looked_for` rule applied to one field kind); constants and result
  facts ground; `result_id` never grounds (it is the library's, not the tool's).

### 3.3 A name that resolves to nothing — `absent({ among })`

```ts
if (!array) return absent({
  what: array_id,
  among: { argument: 'array_id', source: inventory.source, measuredAt: inventory.measuredAt,
           count: inventory.names.length, names: inventory.names, visible: 'caller' },
});
```

The mint composes `checked: [{ facet: 'names', count, source, from: 'result' }]`, keeps
`looked_for` as the name (withheld from evidence, as today), and ADDS a gap the author cannot
remove: `{ kind: 'scope', what: 'names outside <source>', bears: 'source' }`. A typed `not-found`
claim citing this call is stated by the library WITH that gap ("not checked: names outside the
PowerStore inventory export"), so c6's "X is not in your estate" is never written. The only
opt-out is `authoritative: { why }`, which drops the gap; no `source.said` word ever does. The
gate lists every `authoritative` use for review. `known_names` is served as `count` plus the
k = 20 nearest names to the looked-for value under the one spelling, only with `visible: 'caller'`
— REQUIRED, no default even for local tools, because a default would reopen enumeration across
principals; names outside a printable charset or over 128 characters are dropped and counted.
From a local tool the names ground; from a third party they never do; they ride no event, ever.
A schema-malformed value is still a refusal before dispatch (`tools/toolArgsValidation.ts`); a
well-formed unknown value is never one.

### 3.4 Trust, events and laws

- **Compose only from local first-party tools.** A `search` that arrived over MCP or from a
  `ToolProvider` composes a row marked `composed: 'remote'`. It establishes NOTHING and reads
  `coverage-unverified` (§ 5.4). No allow-list in this program (§ 9).
- **Composition can only under-claim, shown.** A facet enters `checked` from exactly five places:
  a value the call sent, a declared default composed as if sent, a declared fixed qualifier, the
  declared (or sent) source, a host-filled identity key. Every classified argument not covered by
  the first three is a bearing gap; a cap in effect, a declared server cap, a page or a `partial`
  status is a bearing gap unless the result says otherwise. A `from: 'result'` fact can only
  NARROW or add a gap: `held` yields the verdict, `paging.next` a gap, `among` a count the claim is
  scoped to plus an irremovable gap, `resolved` binds the sent entity alone. So the composed scope
  is never wider than what the declaration and the arguments say; a wrong declaration is the
  trusted base (§ 6).
- **Composed values ride no event, in any mode.** A `search` tool's `tools.absent` /
  `tools.coverage_declared` carry each facet as a reference `{ toolCallId, argument }` and the
  constants' `what`; the values live on the committed row, under the run's redaction policy like
  every committed value. `lookedFor` and `among`'s value stay as the tool wrote them while
  `.negativeClaims()` is unarmed (today's bytes) and become references under the arm.
  `known_names` is on no event in any mode. The statements (§ 5.1) travel on `turn_end` beside
  `finalContent` — the one event that already carries delivered bytes — and on no other.
- A typed field is never an instruction. A fact the tool returns (`held`, the names, `resolved`,
  `paging`) is the tool's claim, said out loud, checked where § 4 can.
- A tool with no `search` and no `among` composes nothing: rows, events and blocks are today's bytes
  (`test/core/tools/reference/`). An app that uses none of the new fields gets no new build
  warning.

## 4. Part 2 — the declaration overclaim check

One pure rule pack, `semantics/overclaim.ts` (the `tool-lint/rules.ts` shape). Where each rule runs:

| Code | Rule | Doors |
|---|---|---|
| `refusal-asserts-absence` | a not-read result (`invalid`, `denied`, a thrown refusal, a ceiling refusal) carries no `af_absent`, no `known_names`, and no non-existence sentence under the § 5.2 grammar | mint (the library's own sentences pinned by test); `check:semantics` over sample results; **dispatch, when `'negative-claims'` is armed** — c6's refusal is marked at run time on the committed row (`overclaim: [...]`), and the fold reads `declaration-overclaimed` |
| `absence-asserts-wrongness` | an absence's `what`, `why`, `tryInstead` or extra key calls the input wrong ("wrong identifier", "not a valid", "no such") | `check:semantics` |
| `names-count-mismatch` | `among.count` disagrees with the names, or the k shown exceed `count` | mint; dispatch when armed |
| `unclassified-argument`, `gaps-without-bears`, `fixed-without-said`, `checked-beside-declared`, `statement-text-refused` (§ 3.1: multi-line, over-long or instructing text that can reach a statement) | a `search` or a declaration the mint cannot honour | `defineTool` (errors); mint |
| `authoritative-names`, `source-said` (review lists), `said-overlap`, `declaration-instructs` on text that cannot reach a statement (`tryInstead`, a hand-written `notChecked`), `hint-names-unregistered-tool` | review items | `check:semantics` warnings; build warning |

`check:semantics` gains the warnings as WARNINGS by default; they become errors only under
`--strict` or `rules: ['overclaim']`, so no consumer's CI breaks on upgrade; an app that declares
none of the new fields sees no new warning and meets none of the new `defineTool` errors. Beyond
the refusal check and the `among` count, no rule runs at dispatch in this program. A dispatch
finding is read, never repaired: the result reaches the model as written, the row carries the
codes, one dev warning per tool.

## 5. Part 3 — the delivery check for negative claims

One checker, `integrity/negative-claim/` (a sibling of `unsupported-claim/` and `empty-lookup/`).
Two doors, with different powers — **under `exceeds: 'withhold'`, the default, typed claims are
enforced and prose is observe-only; that is the owner-approved split.**

| Door | Claim comes from | Power |
|---|---|---|
| **typed** — a citation the model fills, declared by the app | § 5.1 | an `agentChecks: ['negative-claims']` row: enforce withholds, or delivers the library's statement for that claim; observe records |
| **prose** — the detector over named text fields or the prose answer | § 5.2 | observe only: a committed ledger row, the fold reads `claim-exceeds-search` (not sure), one event, notes. It never withholds, whatever the validation mode, until § 7's gates pass and the owner flips `enforceProse`. Its one other job is gating the softer typed delivery (§ 5.5) |

### 5.1 The typed claim is a citation — the library states, the model points

```ts
negatives: [{ kind: 'none', restsOn: ['claim-result/ns/run-7/3'] }]                             // "there are none" — the scope is that read's
negatives: [{ kind: 'not-found', restsOn: ['claim-result/ns/run-7/5'], about: 'SHPRSTPRNCL003' }]  // an `among` miss
negatives: [{ kind: 'complete', restsOn: ['claim-result/ns/run-7/1', 'claim-result/ns/run-7/2'] }]  // "the rows read are all of them"
```

**The shape:** `{ kind: 'none' | 'not-found' | 'complete', restsOn: [resultId, …], about?: <the
entity as sent> }`, where each `resultId` is the LIBRARY-minted result identity
`claim-result/<ns>/<runId>/<ordinal>` (`integrity/claim-binding/capture.ts · ResultIdentity`,
reserved before dispatch by `reserveResultIdentity`, served to the model as `result_id` beside the
result while the arm is on). Never a provider call id: providers reuse them across iterations,
branches, resume legs and turns, and Gemini shows the model none at all
(`GeminiProvider · isRealId`); #195 rules that provider call ids never select. An entry that does
not parse (`readResultIdentity`), resolves to no committed row, or resolves outside this run leg
(a different `runId` — every `run()` and every `resume()` mints a fresh one, so a read before a
pause is another leg's) is `unreachable: citation-unresolved` / `stale-turn`.

The model writes no scope word: no subject, no source, no qualifier, no window. The claim's scope IS
the composed scope of the cited reads, and the library writes the statement from their rows —
source, subject, fixed qualifiers, filters as sent or defaulted, the window as resolved, and every
gap said out loud as "not checked: …". `about`, when given, must equal a population value of a
cited read (`about-mismatch` otherwise); it is a check, never a binding. Binding is by cited
identity and by nothing else — a `list_changes(payments)` row is never pulled in by the entity's
name.

The app declares the field and the tools that may be cited: `.negativeClaims({ field: 'negatives',
tools: ['list_incidents'] })`.

**Establishing a typed claim.** Every cited read must be of this run leg, outcome `ok`, with a
`composed: 'local'` row. Then by kind: `none` needs each cited read `declared-absent` (an absence,
or an empty rowset inside a declared boundary) and NOT an `among` miss (`kind-mismatch`);
`not-found` needs an `among` absence; `complete` needs each cited read `complete: true` — no
`cap-reached`, no `paged`, no `partial`, `paging.next: null`. **A gap never withholds a typed claim
— it is stated.** What withholds, all monotone:

- `contradicted-by-rows` — a cited read's own result returned rows, or another read of the same key
  (§ 5.3) did;
- `wider-search-has-rows` — a same-tool read of this leg whose composed scope is a superset of the
  cited read's (the same or a wider population, fewer or wider filters, the same or a wider window)
  returned rows, unless every such row is provably outside the cited filters: the row carries the
  filtered field (a `describedResult` fact, or a `resultColumns` column) with a value other than
  the cited one. Rows without the field are never "provably outside";
- `superseded-by-write` — any call of this leg AFTER the cited read that is not a read. A read is a
  call to a tool WITH a `search` declaration or through the `among` path; every other tool call is
  `not-read`. #197 added no read/write classification (its repair turn offers no tools instead;
  a read-only declaration is its owner decision 10), so this over-withholds: a plain lookup tool
  without `search` after the cited read withholds a correct "none". A future read-only
  declaration refines it; until then, declare `search` on every read tool;
- `later-read-failed` — a same-key call after the cited success that did not read (an error, a
  503, a timeout). A failure-then-success still establishes; a success-then-failure never.

**The statement**, from the rows alone (`negative-claim/statement.ts`, fixed templates,
`STATEMENT_VERSION`, carried on `answerNegatives`): one clause per cited read, reads ordered by
ordinal. Every interpolated value — a sent value, a source-role value, `among`'s name and source,
`resolved`, a gap's text — is quoted in backticks, stripped of control characters and newlines,
and capped at 64 characters plus "…". Examples: "`list_incidents` found no incidents for service:
`payments` — status: `open`, any severity, the incident store, 08:00–10:00Z (held in full); not
checked: incidents filed by email." · "`get_capacity` did not find `SHPRSTPRNCL003` among the 14
array names in the PowerStore inventory export (read 09:14Z); not checked: names outside that
export." · "`list_incidents` read 3 incidents for service: `payments` — status: `open`, the
incident store, 08:00–10:00Z — `INC-7302`, `INC-7295`, `INC-7288`; no cap reached, one page." A
`complete` statement states the rows READ — their count and, when the rows carry one, their
identities (a `describedResult` fact's `entity`, or the `resultColumns` id column), quoted and
capped — and never vouches for the model's own list.

**What citation deleted** from the typed path: every claim-versus-`said` containment rule, the
claim's subject, source, qualifier and window fields, `scope-wider`, `subject-unmatched`,
`entity-unresolved`, `gap-relevance-unknown`, `rows-undecided` and `readings-disagree` as typed
verdicts. Those live on only for prose, as notes.

### 5.2 Prose — a fixed grammar, containment as notes

`negative-claim/phrases.ts` holds three closed packs (`NEGATIVE_CLAIM_PHRASES_VERSION`, hashed):
non-existence ("there are no", "has no", "no such", "does not exist", "is not in", "none of",
"nothing is/was", "0 <noun>"), completeness in a frame only ("these are all", "that is every",
"the complete/full list", "all N", "nothing else", "no other" — never bare "every" or "zero"), and
unbounded words ("never", "ever", "anywhere", "at all", "across all", "in the estate / company /
organization / environment"); an app may add phrases as data. `detect.ts`: Unicode-aware (NFC, case
folded, word boundaries on letters); language-detecting over a closed stop-word set (an unsupported
language files a note `language-unsupported`, never a silent pass); Markdown-aware (a table row is
one unit, a list item is one unit; a claim inside fenced or inline code is noted `in-code-block`
with its span); clauses split at "but / however / except / although", each its own unit with its
own polarity; a unit's mentions are its tokens under the one spelling. Each hit records `span`,
`phraseId`, `packVersion`, and nothing of the text.

**Hedges are not scope.** "based on", "according to", "seems", "may be", "does not have", "only
has", "I could not confirm" leave a claim flat. A marker scopes exactly the dimension it names, and
only when it matches a resolved call through that call's declared words: a `source.said` word (or
"the lookup returned nothing") scopes the source; a window phrase scopes the window and must sit
inside the call's `queried`.

**Resolve and containment, as notes.** A prose claim resolves to the calls whose `resolved`
values (for the entity each call was sent for) or `source.said` words it names; a claim naming no
resolvable entity is `entity-unresolved` (the person's-message and single-call fallbacks add a
note naming the candidate, never a binding). Against each resolved call the checker notes what a
typed citation would have made exact: `subject-unmatched`; `scope-wider` (a `fixed` qualifier, a
sent or defaulted filter the claim does not name; no window named over a search with a period; an
unbounded word — never disarmed by a `source.said` word); `coverage-gap` (a gap bearing on a facet
the claim leaves open — a `{ filter, values }` gap bears exactly when the claim names one of its
values); `cap-reached`, `paged`, `partial`; `empty-undeclared`, `clarify-open`, `period-*`,
`call-not-read`, `declaration-overclaimed`; `rows-undecided` (rows on the call the claim rests on
that neither fit nor contradict); `gap-relevance-unknown` (a hand-written gap). None withholds.
Worked, on the § 3.1 tool: "no open incidents on payments" with no window is `scope-wider` — rule
5 holds back natural prose true zeros, which is acceptable only because prose is observe-only;
the typed citation of the same read is established, and the library's statement carries the
window. "No critical incidents on payments" is `scope-wider` as well (status: open unnamed); "no
open incidents on payments in the last two hours" is noted established. The study's 22 true zeros
would mostly read `scope-wider`, not false fires: a note, and the fold's layer-3 rows say what was
searched.

**The prose path keeps its own ledger.** Today only an agent with `.answerValidation()` keeps
`toolCallLedger` (`core/Agent.ts`); `.negativeClaims({ prose })` arms it the same way, so the
prose notes can say whether a call read.

### 5.3 Readings — the one departure from #197

A reading's key is (tool, arguments in effect), inert arguments left out; a relative window
(`'2h'`) keys by its span resolved on the LEG's clock (the time layer's injected `now`), never by
the result's `period.queried`, so a retry after a 503 in the same leg is the same key. A cited read
and the answer must be in the same run leg — no pause between — else `stale-turn`. Within one key
a later read replaces only an UNREAD outcome (an error, a 503, a timeout, not-run); two reads of
one key that both read and disagree — one empty, one rows — contradict a typed claim citing either
(`contradicted-by-rows`) and are `readings-disagree` for prose. Across keys a sibling never
establishes a typed claim and withholds one only by `wider-search-has-rows` (§ 5.1). For prose a
sibling counts only where it bears (its rows under the rows rule — a call contradicts only when it
applied every qualifier the claim names; a period gap only where its unheld span overlaps the
claim's window and its population is the claim's entity). Adding a key never relaxes a verdict
(the #197 monotonicity property, as it pins it). The departure is narrower than #197's contract
because a key is a search the library composed, not a row any tool could forge.

### 5.4 Judge — the row

Typed rows `agent:negative-claims:<field>#<n>` carry `path`, the claim index, the verdict code, the
tool names and the cited identities; prose observe rows (`FindingsRow` kind `negative-claim`)
carry `field`, `span`, `phraseId`, `packVersion`, the note codes and the resolved call ids. Never
a value or a sentence.

| Typed verdict | Disposition |
|---|---|
| no claim; or established | `not-applicable` — established clears the claim, never verifies the answer (no agent row is `checked-pass`) |
| `contradicted-by-rows`; `wider-search-has-rows`; `search-incomplete` (`complete` cited on a read that is not `complete`: a cap reached, a next page, a `partial` status); `superseded-by-write`; `later-read-failed`; `prose-repeats-claim` (§ 5.5) | `checked-fail` |
| `citation-unresolved` (`restsOn` empty, an entry that does not parse, or one no committed row of this leg carries); `cited-call-undeclared` (no composed row: no `search`, no `among`); `coverage-unverified` (a `composed: 'remote'` row); `call-not-read` (error, refused, denied, not-run, `clarify`, `unknown` shape); `kind-mismatch` (`none` on an `among` miss; `not-found` on a read that is not one; `none` on a `coverage()` with rows); `about-mismatch`; `record-incomplete` (`toolCallLedger.complete` false, or a key kept out by redaction); `stale-turn` (another leg's read); `language-unsupported` under `record-composed` | `unreachable` |

Two conditions the codes above share, stated once:

- **"Same search" and "same key"** — in `later-read-failed`, `readings-disagree`, the same-key
  contradiction and `wider-search-has-rows`' superset test — mean the COMPOSED executed scope of
  the row: the tool, every filter in effect including `whenOmitted` defaults, the `fixed`
  qualifiers, host-filled identity filters by reference, and the resolved window. Never the tool
  name alone, and never the model-visible arguments alone.
- **`superseded-by-write`** counts every `not-read` call DISPATCHED after the cited read, whatever
  its outcome — success, error, timeout, abort, `partial`: an uncertain write may have changed the
  backend. A call refused before dispatch never ran and does not count. A `not-read` call in the
  same parallel batch as the cited read counts as after it.

`validate.ts` already makes a `checked-fail` row a `failed` report and an `unreachable` row an
`unverified` one; enforce withholds both. The fold reads a failed typed row, or a prose row, as
`claim-exceeds-search` (layer 4, not sure) and an unreachable typed row as `check-unreachable`.

### 5.5 What the person sees

- **Observe** (either door): the model's answer, unchanged; the rows; `not-sure` on
  `turn_end.answerAssessment` and in the answer account.
- **Enforce, typed, `exceeds: 'withhold'` (the default)**: typed claims are enforced, prose is
  observe-only. A failing or unreachable typed row withholds the answer whole;
  `AnswerValidationError`, 422 over a host, `RUN_ERROR` over AG-UI; the app renders from the
  report.
- **Enforce, typed, `exceeds: 'record-composed'`**: the rest of the typed answer is the model's;
  for each established claim the library's statement (§ 5.1) is delivered as data on
  `turn_end.answerNegatives` with `STATEMENT_VERSION`, the REQUIRED marker `delivery:
  'record-composed'`, which the app must show beside the sentence, and the actions-taken line from
  the trusted attempts (#195 § 3.6). Never a whole-answer replacement, and never prose the library
  wrote into a prose answer. **The model's words must not state a negative beside it**: the prose
  check runs over EVERY string in the answer, not only `prose.fields`; a negative inside a code
  block counts; an unsupported language fails closed (withhold); any detected negative sentence
  with no citation — named entity or not, "there were no incidents in the last two hours" included
  — is a repeat. On a repeat the library runs ONE correction turn with NO tools (as #195
  `a627ae8da` and #197 `72b7c3262` now run the repair turn), request-only context naming the
  field (the `buildEvidenceRecovery` shape), counted against the turn's one-extra-call budget;
  the corrected answer re-runs the FULL check, citations re-validated; if a negative sentence
  persists the row is `checked-fail: prose-repeats-claim` and the answer is withheld whole. The
  prose detector gains no power of its own here: it only decides whether the softer delivery is
  allowed.
- **A follow-up turn or a resumed leg** citing an earlier leg's read: observe files a dated note
  ("`list_incidents` was read at 09:14 on turn 1; not re-read"); typed enforce is
  `unreachable: stale-turn` with that date in its reason — a withhold that says why.

### 5.6 The arm

```ts
Agent.create({ provider, model })
  .tool(listIncidents)
  .outputSchema(IncidentReport)                                  // { summary, incidents, negatives }
  .negativeClaims({ field: 'negatives', tools: ['list_incidents'], prose: { fields: ['summary'] } })
  .answerValidation({ id: 'incident-report', version: '1',
    agentChecks: ['negative-claims'], exceeds: 'withhold', validate: () => ({ checks: [] }) })
  .build();
```

`build()` refuses `'negative-claims'` without `.negativeClaims()`, a `field` the schema does not
declare, a tool it does not register, and `'record-composed'` without `prose.fields`. An agent that
lists nothing is byte-identical; a prose-only agent (`.negativeClaims({ prose })` with no
`.outputSchema()`) files observe rows from the Route decider, keeps its own `toolCallLedger`, and
needs no validation door. Until the typed arm's gates pass (§ 7), the docs present typed enforce as
available but not recommended.

## 6. Threat model

| Input | Trust | It cannot |
|---|---|---|
| The model's typed citation | untrusted | widen a scope (it writes none); cite a provider id, another leg's read, a read that did not read, an undeclared tool, or one with rows; hide a gap (the statement says it); inject text into the statement (nothing of the model's is interpolated) |
| The model's prose | untrusted | be stated by the library; pass by phrasing — a flat phrasing the grammar misses is a MISSED claim, measured, and the layer-3 reasons still mark the answer; a hedge is not scope; under `record-composed` any negative string beside the statement is a repeat |
| A value that reaches a statement (a sent argument, a source value, `among`'s name, a row identity, `resolved`) | untrusted bytes | carry control characters, newlines or length into the sentence: quoted, stripped, capped at 64 |
| A third-party envelope, `search` or `among` (MCP, a provider) | untrusted | establish anything (`composed: 'remote'` → `coverage-unverified`); ground its names; forge a composed row or a result identity — only the local funnel writes them |
| Injected text in a tool result | untrusted | add a row or a fact; it sways the draft, and the draft is checked |
| A buggy local tool: a `search` whose query differs, an undeclared built-in qualifier or server cap, a wrong `complete`, `held`, `resolved` or `paging` | the trusted base, said out loud | be caught except by the consistency rules; the sealed side log and a misreport bench cell are the outside check (#195 § 6) |
| A forged or stale checkpoint; a `resumeOnError` leg | shape-checked | list calls that never ran (`record-incomplete`), or lend another leg's identity (`stale-turn`) |
| A redaction policy keeping out a key the check reads | the app's law | be read around: `record-incomplete`; events carry references, not values |
| A refusal written to persuade | the author's words | reach the model unmarked when the check is armed; the gate flags it before |

Fail closed: every error, limit, timeout, unresolved citation, unread or superseded call, remote
row or kept-out key is `unreachable` or `checked-fail`, never `not-applicable`. The check vouches
for agreement with the record of the search, not for truth.

## 7. Measurement

**Frozen first.** `bench/negative/RULE.md` records, before any label or paid call: the grammar's
hash (`phrases.ts`, its version), `STATEMENT_VERSION`, the tool rewrites (`search`, `among`,
`resolved`, `paging`) for every case, the case split, and the gates below.

**Split by case, then by model.** The 21 study cases are split before any label: 8 tuning cases
and 13 held-out cases (both flagship questions held out). The split applies to BOTH models: Sonnet
and Haiku replies of the 8 tune, replies of the 13 test; within each, PROMPT-arm replies tune and
PLAIN/DECLARED replies test. The paid arms' cases are assigned to the same splits so that the
true-zero minimum holds in the held-out split: of Haiku's 8 true-zero cases, 6 held out and 2
tune; of Sonnet's 4, 3 held out and 1 tune. Every number is reported per split and per model;
gates are read on held-out cases only.

**Labels independent of the grammar.** The study's replies are relabelled at the SENTENCE level,
with the tool results shown to the rater, by raters who never see the grammar; the owner
adjudicates a stratified sample of 80 sentences, later. **Floors count replies, with a minimum of
cases:** positives (flat claims the record cannot support) ≥ 30 replies from ≥ 5 held-out cases;
negatives (true zeros and scoped claims over a complete search) ≥ 30 replies from ≥ 6 held-out
cases. Natural positives alone count; planted drafts stay scripted.

**Scripted (mock provider), zero tolerance.** Every typed verdict of § 5.4 and every prose note of
§ 5.2; citation resolution (a provider id, a Gemini-style missing id, another leg's id, an
unparseable entry, an ordinal no row carries); the statement composer against each row shape
(fixed, `{ any }`, a sent source, a host-filled key, a server cap, `paging`, `partial`, `among`
with its gap, `authoritative`) and its sanitising (control characters, newlines, the 64-character
cap, ordering by ordinal, one clause per read, the rows read of a `complete`); the withhold codes
(`wider-search-has-rows` with and without provably-outside rows, `superseded-by-write` for a
non-`search` lookup and for a write, `later-read-failed`); the readings rule (a 503 retry in one
leg keyed the same; a read before a pause cited after it); ≥ 6 true-zero cases over a complete
search — one with an irrelevant gap on another call, one narrow-then-wide pair, one with the
email gap — each typed citation `not-applicable` and each prose sentence noted as § 5.2 says; the
planted "says flatly" scripts each failing with the expected code; `prose-repeats-claim` with and
without a successful no-tools correction turn, the re-run re-validating citations; the c6 refusal
marked at dispatch; byte identity for every unarmed agent; in-run standing = read-after fold.

**Free replay.** The detector and resolver over the 819 + 72 recorded replies and the 21 cases:
precision and recall against the sentence labels, with case-clustered 95% bounds; an ablation
baseline — "withhold every detected flat claim" — beside detector + record.

**Paid arms.** (a) The approved OBSERVE arm: Haiku 4.5, 24 cases × 15 = 360 replies, of which 8
true-zero cases (120 replies); Sonnet 4.6, 10 cases × 10 = 100 replies, 4 true-zero cases (40);
≈ $2.30. (b) **A TYPED arm, new — the typed path was unmeasured:** the same cases with the
`negatives` field in the schema and `result_id` served, the models asked to emit typed negatives
with citations; Haiku 24 × 10 = 240 replies, Sonnet 10 × 5 = 50; ≈ $1.30. Measured: citation
validity (entries that resolve, per model), the repeat rate under `record-composed`, the
correction turn's success rate, false holds on the true-zero cases, the statement's token cost.
Gemini-style missing ids are covered by the mock-provider tests, never by a paid run. **Together
≈ $3.60, above the approved $3 cap: the typed arm needs the owner's approval of ≈ $0.60 more (cap
$4); without it the observe arm runs alone and typed enforce stays "available, not
recommended".** Dispositions are computed offline from the recordings; no enforce arm is paid for.

**Gates, on held-out cases, case-clustered 95% bounds (point estimate; bound):** detector
sensitivity ≥ 0.85 (lower ≥ 0.70); detector specificity ≥ 0.95 (lower ≥ 0.85); false holds — a
typed citation of a true zero over a complete search withheld or held `unreachable` — ≤ 0.02
(upper ≤ 0.10) over ≥ 60 true-zero replies from ≥ 6 cases; missed overclaims — a flat claim over
an undeclared, partial, refused or overclaiming search not flagged — ≤ 0.05 (upper ≤ 0.15);
specificity ≥ 0.10 above the ablation baseline. Typed arm: citation validity ≥ 0.90 per model
(lower ≥ 0.80); repeat rate ≤ 0.20 before the correction turn and ≤ 0.05 after; false holds as
above. Reported: the prose `scope-wider` rate on true zeros; `unreachable` by code; the
over-withhold of `superseded-by-write` on non-`search` lookups; the statement's token cost.
Enforce on prose becomes a flag only if the detector gates pass; typed enforce becomes
"recommended" only if the typed gates pass.

## 8. What ships, in order

| PR | Ships | Off = byte-identical |
|---|---|---|
| 1 · the c6 fix (in flight) | `absent({ among })` with the cap, caller visibility (required), the irremovable gap (`bears: 'source'`) and `authoritative`; refusal-sentence pins at the mint; `refusal-asserts-absence` and `absence-asserts-wrongness` in `check:semantics` (warnings); `known_names` on no event | yes |
| 2 · `Tool.search` (in flight) | classified `arguments` for every role, the two `whenOmitted` forms, `fixed`, `subject`, `said` words (`said-overlap`, `source-said` review list), a sent `source` replacing the declared one, `limits.cap`, `complete`, typed gaps with `bears` (`{ filter, values }`; `completeness` for cap, page and `partial`), host-filled arguments by identity key, `resolved` bound to the sent entity, `paging`, `checked: 'declared'`, local-only composition, `composed: 'remote'`, references on events in every mode, the under-claim proof pinned for `from: 'result'`. **Revision 5 asks of it:** `statement-text-refused` at `defineTool` (an error: multi-line, over 120 chars, instructing text in `source.what`, `subject.what`, a `fixed` value, a gap's `what`/`why`); a `partial` status composes a `completeness` gap; the row carries `resultId` from the reserved identity | yes |
| 3 · the checker (in flight) | `integrity/negative-claim/`: phrases (moved from the bench), detect, the prose resolver with containment NOTES, the typed citation's establishing rules (§ 5.1) and verdicts (§ 5.4), the statement composer, the readings key on the leg's clock; replayed free against the recorded replies and the 21 cases. **Revision 5 asks of it:** bind by `ResultIdentity` (`readResultIdentity`; `citation-unresolved`, `stale-turn` on another leg's `runId`), never by provider call id; `wider-search-has-rows` with the provably-outside test; `superseded-by-write` with "a read = a `search` tool or `among`"; `later-read-failed`; `kind-mismatch` for `none` on an `among` miss; `search-incomplete` on `partial`; the statement's quoting, stripping, 64-char cap, ordinal order, one clause per read, and the rows read of a `complete`; the prose `cap-reached`, `paged` and `partial` notes | — |
| 4 · typed negatives | `.negativeClaims({ field, tools })`, `result_id` served beside each result under the arm, the `'negative-claims'` row, `exceeds: 'withhold' \| 'record-composed'`, the every-string prose check under `record-composed` (code blocks counted, unsupported language withheld, uncited negatives as repeats), the NO-tools correction turn and the full re-check, `prose-repeats-claim`, `turn_end.answerNegatives` with `STATEMENT_VERSION`, the marker and the actions line, the fold reason, the dispatch-time refusal check under the arm; docs: "available, not recommended" until § 7's typed gates pass | yes |
| 5 · prose, observe | `.negativeClaims({ prose })`: the ledger row from the Route decider, its own `toolCallLedger`, the event, the fold reason, the notes (`in-code-block`, `language-unsupported`, the containment notes), the dated follow-up note | yes |
| 6 · the paid bench | `bench/negative/`: the observe arm (approved) and the typed arm (needs ≈ $0.60 more); `enforceProse` ships only if the detector gates pass; typed enforce "recommended" only if the typed gates pass | — |

4 needs 1–3; 5 needs 3; 6 after 5. Deferred: the dispatch-time rule pack beyond the refusal and
`among` checks; a forced fresh read on a stale turn; a read-only tool declaration (which would
narrow `superseded-by-write`); preserving a remote tool's MCP `outputSchema`, its annotations and a
definition digest on the listed-tool catalog — the hook for a future hash allow-list, and for
suspending a declaration when a remote definition changes under it. Cut: a library-written scoped
form for prose; model-written scope words in a typed claim.

## 9. Decisions — DECIDED (owner, 2026-10-22; the library calls, with their why)

1. **Names** as proposed: `search` (`source`, `subject`, `fixed`, `arguments`, `role`,
   `whenOmitted`, `said`, `limits`, `complete`, `gaps`, `bears`), `checked: 'declared'`, `among`,
   `resolved`, `paging`, `result_id`, `negatives` (`kind`, `restsOn`, `about`),
   `.negativeClaims()`, `exceeds`, `record-composed`.
2. **`complete` absent = never complete.** Why: silence must never read as completeness.
3. **Readings rule: not "latest settles".** A later read replaces only an unread outcome (error,
   503, timeout, not-run); two reads of one key that both read and disagree contradict (typed) or
   are `readings-disagree` (prose); inert arguments are left out of the key; a relative window keys
   by its span resolved on the leg's clock, never by the result's `period.queried`, so a same-leg
   retry is the same key; a cited read and the answer must share a run leg. Why: a retry must not
   withhold a correct "none", and a real disagreement must never be settled by order of arrival.
4. **`known_names`: `visible: 'caller'` required; no default, local tools included.** Why: a
   default-visible list reopens enumeration across principals.
5. **Remote declarations: no allow-list now.** A `composed: 'remote'` row establishes nothing and
   reads `coverage-unverified`. Why: a field need decides.
6. **Stale turn: `unreachable: stale-turn` with the date.** Why: a withhold that says why; the
   forced fresh read waits for #195 § 8's fetch.
7. **Typed claims enforced; prose observe-only; library wording only for typed claims with the
   required marker; the paid observe arm ≈ $2.30 within the $3 cap, Haiku and Sonnet; the owner
   adjudicates the 80 sentences later.** As approved. The typed arm (§ 7) is a new ask: ≈ $0.60
   over the cap, the owner's call.
8. **`check:semantics`: warnings until a later major.** An app using none of the new fields gets no
   new build warning and meets none of the new `defineTool` errors. Why: an upgrade must not break
   a consumer's CI.
9. **A typed negative claim is a CITATION, not a restated scope** (the coordinator's ruling under
   "decide for the library"): `{ kind, restsOn: [resultId, …], about? }`, the entries the
   library's result identities; the model writes no scope word; the scope is the cited reads'
   composed scope; the library writes the statement, gaps said out loud. Why: the verifier showed
   a typed claim has no defined source, subject or fixed qualifier of its own, so every containment
   rule either failed always or over-claimed, and matching the model's words against declared
   `said` words is where every revision-3 hole lived. With citation the statement cannot be wider
   than the search by construction. "The library states negatives; the model only points."
   Containment stays only as prose notes.

## 10. Considered and rejected

| Proposal | Why not |
|---|---|
| A typed claim that restates its scope (`qualifiers`, `window`, a subject) | revision 3: no defined subject, source or fixed qualifier to contain it in; the model's words against `said` lists is where every hole was. The model points; the library states |
| Citing a provider call id | reused across iterations, branches, resume legs and turns; Gemini shows the model none (`isRealId`); #195: provider call ids never select. The library's `ResultIdentity` is the one handle |
| Generating `search` declarations or evidence profiles AT RUNTIME with a model, activated automatically | a declaration is itself a claim (the study's c6 finding); a remote tool's description is untrusted text, so feeding it to a profile-writing model is an injection path into the verifier; a wrong mapping between two same-typed fields passes every structural check and upgrades a false answer to "supported" — the worst failure; and verification must be deterministic code. Kept open: an OFFLINE authoring helper that drafts a declaration from a schema for a person to review, commit and pin by definition digest — never self-activating, run through the overclaim lint |
| A fourth result door | one wire shape; `among`, `resolved`, `paging` and `checked: 'declared'` are fields on it |
| Checking the call against its own declaration | revision 1's rule: it established "never had an incident" from an open-incident search |
| Deciding fit by token shape | singular, plural and case prove nothing; only declared `said` words and `resolved.aliases` bind a prose claim's words, and only as notes |
| Hedges as scope | "seems", "based on", "does not have" scope nothing; only a named source or window does |
| A library-composed scoped sentence replacing a prose answer | the draft is untrusted, and so is prose the library writes into it; a statement exists for a typed citation only, marked, never a whole answer, never beside a negative string of the model's |
| The person's message or the turn's single call as a binding | a coincidence is not a binding (the `coincides` precedent); they add a note, never establish |
| Binding a typed claim by entity | `list_changes(payments)` rows would be pulled into a claim about `list_incidents`; a citation names the read |
| A correction turn with read tools | #195 `a627ae8da` and #197 `72b7c3262` settled it: no automatic turn is offered any tool; a corrected answer must stand on reads already made |
| A model judge for the claim type | the registered rater is what a deployment lacks; the library refuses a bigger model policing a smaller one |
| Counting every declared gap of the turn | the study's 22 false fires; for a typed claim a gap is stated, never a withhold; for prose it bears only on a facet the claim leaves open |
| "Latest settles" across retries | it would let order of arrival settle a real disagreement; only an unread outcome is replaced |
| `known_names` as the whole list, visible by default, as evidence from any tool | enumeration across principals; a third party's names never ground |
| Error-level `check:semantics` rules on upgrade | a consumer's CI must not break without an opt-in; the new `defineTool` errors touch only the new fields |
| Carrying `coverageDeclared` into the next turn or leg | the "this turn only" law; a stale search is what a follow-up must not stand on; `ResultIdentity` carries the leg's `runId` for exactly this |
