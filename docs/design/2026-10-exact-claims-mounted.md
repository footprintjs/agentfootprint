# Exact claims, mounted — checking a delivered answer against the tools' typed results

**Status: design only (2026-10-22).** It builds on the unmounted exact-claim helpers and on an
outside review's plan (§ 8). Paths are under `src/`; code is cited as `file · symbol`.

**Position.** The app declares which answer fields are claims and which tool may settle each. The
**runtime** binds each claim to a recorded result through that rule and the run's trusted scope.
The model never names the evidence: in our step-5 bench, Haiku 4.5 declared the source of 8 of 109
argument values (`bench/inputs/runs/haiku45-step5/report.md`), and a model-chosen reference can
point a claim at the wrong result.

**First milestone:** one refund-status task with typed direct facts. Prose claims (where the app
declares a claim shape), derived figures and non-existence rules come later.

## 1. What exists today

| Piece | Where | Limit |
|---|---|---|
| `.findings()` | `core/agent/findings/ledger.ts · recordFindings` | the model's declarations; "fact" verifies nothing |
| Names-and-numbers gate | `core/agent/evidence/gate.ts · checkAnswer` | membership: "port X is healthy" over a down port passes |
| `.claims()` | `core/agent/stages/route.ts · judgeClaims` | compares mapped fields with the latest unscoped `(entity, field)` row; files an event; changes nothing |
| Answer validation | `answer-validation/validate.ts · executeAnswerValidation` | checks the digested candidate; `enforce` withholds `failed` and `unverified` |
| Exact-claim helpers, not mounted | `integrity/claim-binding/`, `integrity/unsupported-claim/evaluate.ts · evaluateClaimPair`, `core/agent/findings/verification*.ts` | receipts tied to executed scope and served payload; exact binding; bounded retention; a checkpoint carrier |
| The standing fold | `core/agent/assessment/assess.ts · assessAnswer` | "known" needs a tie check; today only a passed enforce report |

## 2. What is missing

1. **Capture.** No execute boundary calls `captureDispatch`, `captureReturnedEvidence` or
   `finalizeEvidence`; `claimFacts` has no scope, coverage or link to the served payload.
2. **Runtime selection.** `bindClaim` takes a result id; the only adapter written starts from the
   model's declaration (`core/agent/findings/verificationCheck.ts · checkFindingClaim`).
3. **Trusted scope and freshness.** `AgentInput` has no place for an order id; nothing checks
   `measuredAt`.
4. **Delivered bytes.** `judgeClaims` parses the raw draft (`route.ts · readValidatedAnswer`), not
   the digested candidate.
5. **Committed verdicts.** `.claims()` verdicts are events only; the fold cannot read them
   (`core/agent/assessment/README.md`, "Not covered").
6. **Governance.** Nothing withholds on a claim; `requireVerificationOnResume` is always called
   with `false`; there is no abstention.
7. **Measurement.** None.

## 3. The proposed wiring

### 3.1 The app's contract

```ts
agent
  .outputSchema(RefundAnswer) // { order, refund_status, amount }
  .claims(
    {
      refund_status: { tool: 'get_refund', fact: 'status', required: true },
      amount: { tool: 'get_refund', fact: 'amount', required: true },
    },
    { scope: { customer: ['customerId'], order: ['orderId'] }, entity: 'order', maxAgeSeconds: 300 },
  );
await agent.run({ message, claimScope: { customer: session.customerId, order: page.orderId } });
```

Claims are the typed fields named here, never prose. Names are not final; this compiles to
`ClaimBindingRule` (`integrity/claim-binding/admit.ts · bindingRuleOf`). `claimScope` comes from the app's session,
never from the model. A rule names one tool, so a successful `issue_refund` can never settle "your
refund has settled"; only a `get_refund` record can.

### 3.2 Capture at real execution

For a ruled tool, the runtime reserves an occurrence id before awaiting
(`verificationState.ts · reserveResultIdentity`); provider call ids never select a result. Where
`core/agent/stages/toolCalls.ts · declareCoverage` runs, it captures the arguments `execute`
received and the returned envelope. Where results are finalized (the batch loop and the four resume
paths), it ties them to the payload actually served, under the app's grant. Receipts ride the
checkpoint carrier. Without a contract, nothing new is written.

### 3.3 Binding at the delivered bytes

Inside answer validation, on the candidate named by `candidateDigest`, for each claim: read the
field (absent, `null` or `"unknown"` is `missing-claim`); take the scope from `claimScope` (a
missing key is `scope-missing`); collect this turn's receipts from the rule's tool whose executed
scope matches exactly (`integrity/claim-binding/scope.ts · scopesMatch`); take the latest, and if
it is unavailable, stop rather than fall back; then run `bindClaim`, the `measured_at` age check
and `evaluateClaimPair`. A reference the model cites is at most a recorded hint.

### 3.4 Verdicts

| Verdict | When | Report check |
|---|---|---|
| `supported` | bound, no conflict | `checked-pass` |
| `contradicted` | bound, conflict: the draft says `settled`; `get_refund` (call 2, 09:14) says `pending` | `checked-fail` |
| `not-checked` | no in-scope read, another scope, stale, incomplete coverage, withheld, a missing claim, a limit or an error | `unreachable` |

Each verdict is one committed `findingsLedger` row through the one writer (turn, digest, rule
version, receipt, reason), plus one `AnswerCheck` in the validation report.

### 3.5 Standing

`assess.ts · readAnswerRows` reads this turn's rows for the delivered digest. `contradicted` fires
`claim-contradicted` (planned in `docs/design/honesty/README.md` § 4.2), `not-checked` fires
`check-unreachable`, and every required claim `supported` is the tie check behind "known". An
abstention never reads "known": the draft's rows still fire.

### 3.6 Enforce

The checks join the one report the delivery owner reads, so they plug into the parallel PR's
enforce setting, whatever its spelling: present when a contract exists, withholding on a failing or
unreachable claim, and delivering by this table.

| Required claims | Enforce delivers |
|---|---|
| all supported | the checked typed answer |
| a scope key missing | an ask for that key |
| not checked | "I don't know", with the limitation |
| contradicted | one correction and a fresh check; still failing → "I don't know" |
| checker error or timeout | "I can't verify this right now" |

Observe delivers the draft with its rows and standing. The correction states the field, the
recorded value and its source in request-only context (as
`core/agent/evidence/recovery.ts · buildEvidenceRecovery` does) with no tools offered, so it cannot
repeat `issue_refund`. Partial answers come later.

## 4. What the person sees

The text comes from the app's templates, keyed by decision and reason code, never from the withheld
draft (which was never streamed). Without a template, enforce raises `AnswerValidationError` as
today.

- **Delivered:** "Your refund of $42.50 for order A-1001 has settled." Standing: known (two claims
  checked against `get_refund`, read 09:14).
- **Not checked:** "I can't confirm the refund for order A-1001 right now: the payment record I
  could read is over five minutes old."
- **Corrected:** only the corrected answer; the record keeps both drafts.
- **Scope missing:** "Which order is this about?"

## 5. Threat model

| Input | Trust | It cannot |
|---|---|---|
| The model's draft and its `_findings` | untrusted | choose evidence, rule or scope; pass by omitting a required claim; smuggle oversized JSON (`lib/boundedJson.ts · copyJson`) |
| Tool text | untrusted | add a fact: only a recognized envelope matching the served payload counts (`semantics/envelope.ts · readSemantics`). Injected text may sway the draft, which is then checked against facts |
| Another customer's result | none | bind: its scope must equal the trusted scope |
| A saved checkpoint | shape-checked only | be trusted off-server; history-only continuations carry no receipts |
| App contract, `claimScope`, tool envelopes | the trusted base | — |

**A wrong tool declaration is the bound.** The check vouches for agreement with the tool, not for
truth: a misreported status makes a false claim "supported", and overstated coverage can flip
either verdict. So verdicts name their source, scope declarations carry versions, and completeness
is the app rule's call. **Fail closed:** any error, limit, timeout, missing carrier, withheld grant
or ambiguity is `not-checked`, never `supported`, and enforce delivers only the checked bytes.

## 6. Tests and measurement

**Scripted tests (mock provider):** every verdict and not-checked reason; `issue_refund` success
and other customers' receipts never support; reused provider call ids; a later failed read blocks
an older one; middleware edits are what gets checked; corrections call no tool; every boundary
captures; receipts survive pause and resume, not `continueFrom` or `resumeOnError`; no withheld
token streams (`test/ag-ui/answer-validation-guard.test.ts`); the fold reads each verdict; unarmed
agents stay byte-identical (`test/core/tools/reference/`). Planted errors prove detection; the paid
run measures real drafts.

**Registered rule `claims-rule-m1`** (`bench/claims/RULE.md`, written before any paid call; run only
on the owner's budget go):

- **Model:** Haiku 4.5 (`claude-haiku-4-5-20251001`), step 6's protocol (`bench/answer/RULE.md`).
- **Cases (12):** control (settled, pending, failed, partial amount); provoking (issued but
  pending, pending then settled, a sibling order settled, near amounts); fail-closed (no order key,
  stale record, another customer's order, `absent()`).
- **Arms:** `observe` and `enforce` (with the correction), 10 runs per case: 240 runs. Enforce
  without the correction is refolded from `observe` at $0; byte identity uses a scripted `off`.
- **Outcome:** each claim labelled true or false by a deterministic fixture reader, never a model.
- **Pass bar, all of:** false verdicts 0; false deliveries under enforce 0; fail-closed runs end in
  an ask or abstention, 100%; needless abstention on controls ≤ 0.10 over ≥ 40 answers; first
  request byte-identical to `off`, 12 of 12; tool calls in corrections 0; in-run standing equals
  the read-after fold, 100%; model calls per run ≤ 1.15 × `observe`. Too few answers is
  NOT-MEASURABLE.
- **Reported:** the natural false-claim rate, correction success, the reason mix. No efficacy claim
  until 40 blind labels agree with the reader at ≥ 0.90.
- **Cost:** step 6's 240 Haiku runs cost $0.77; estimate about $1, cap `--max-usd 2.00`.

## 7. Risks and open questions

1. **Extend `.claims()`?** Yes, one contract. The short `{ entity, field }` form stays
   report-only: unscoped, it never withholds and never supports "known".
2. **Reuse `ClaimVerificationRow`?** No: a sibling kind sharing its `resolved` shape, because that
   row records a model declaration.
3. **Conflicting reads?** The latest settles; a later unavailable read blocks; disagreeing reads in
   one parallel batch are not checked.
4. **Correction on by default?** No, abstain, until the bench shows it adds no false claim.
5. **A clarifying question claims nothing.** Allow a declared claim-free ask variant; any other
   missing required claim abstains.
6. **Over-abstention** from tools that declare no coverage: warn in dev mode on the first
   `coverage-undeclared`, and count it in the bench.
7. **Release:** opt-in and off by default until the rule passes. Draft PR #109's bar stands: zero
   false verdicts.

## 8. Where this differs from the outside plan

Every path and helper the plan cites exists on `main` (checked 2026-10-22).

| Topic | Outside plan | This design |
|---|---|---|
| Who binds a claim | the model's declaration names a result, rule and value (`checkFindingClaim`) | the runtime, by the app's rule and trusted scope; a model reference is a recorded hint at most |
| The claimed value | a literal in the declaration | the delivered field itself |
| Served to the model | an extended findings schema | nothing new (step 5 failed its cost clause: about 4.9 × the input tokens per call) |
| Recovery | may fetch evidence or ask | asks only for a missing scope key; the correction is answer-only. Fetching needs a read-only tool declaration, which does not exist yet |

Kept: app-owned required claims, capture at real execution, runtime identity, digest-bound
delivery, the decision table (partial delivery later), reason-code fallbacks, no "known" for an
abstention, the continuation carrier, blind labels and the refund milestone.
