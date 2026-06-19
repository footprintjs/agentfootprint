# Proposal 010 — Contextual Error Types + typed recovery strategies

**Status:** DESIGN (plan only — no code until approved)
**Builds on:** 009 (skill-body↔tool-contract), `toolContractCheckup` (6.40.0), `localizeContextBug`,
the missing-context finder, the honesty markers.
**Origin:** the maintainer's "HTTP-status-codes for context errors" framing + a literature scan
(MAST, Who&When, TRAIL, RAG FP1–7, OWASP LLM Top-10, CRITICTOOL/BFCL) confirming the axis is
**white space**: prior schemes classify *which agent / which step* failed (Who&When, MAST) or tag
the agent's *mishandling* of context (TRAIL), but none is a **standardized, enumerated, element-keyed
code the localizer can ASSIGN**, and none drives a **recovery strategy**.

> **The thesis in one line:** give context errors *typed codes* (like HTTP status codes) **and** a
> *typed handling strategy per code* (like HTTP retry/redirect semantics). Classification without
> handling is a label; classification **with** handling is a framework.

---

## Part A — The taxonomy (the maintainer's refined framing)

The organizing axis is **not** "tool vs skill vs instruction" — it is the **request ↔ response
boundary at field-description granularity**, because the *same* root (an unclean description) recurs
on two faces, and each face has the **same fix** (write a clean description):

| Face | The unclean thing | The model's mistake | When caught |
|---|---|---|---|
| **REQUEST** — what the model reads to *decide / call* | tool description (choice) · **input-field / arg description** · skill description · system-prompt instruction | wrong tool, wrong arg value, follows a misleading instruction | **build-time** (`toolContractCheckup`, 009) |
| **RESPONSE** — what the model reads to *interpret the result* | **output-field description** (`_id` returned but never described) · response structure | **misreads** the result | **build-time** — *new checker (Part C)* |

This request/response trunk owns the dominant, most-fixable mechanism: **unclear / ambiguous
description**. But four mechanisms are **not** description-clarity and must stay first-class (forcing
them into "two types" would hide them):

| Residual mechanism | Why clarity can't explain it | Confirmed by |
|---|---|---|
| **stale** | field is clear + well-formed, just out of date (B2) | runtime |
| **absent** | the needed unit isn't there to describe (B6) | **restoration** |
| **conflicting** | two clear fields contradict (B5) | runtime |
| **misleading-but-clear** | reads clean, is a lie (B1/B3 poison) | **ablation** |

So a **Contextual Error Type** is a triple:

```
{ face: 'request' | 'response',
  surface: 'instruction'|'tool-desc'|'tool-input'|'tool-output'|'retrieval'|'fact'|'memory'|'skill-desc'|'skill-body',
  mechanism: 'unclear' | 'misleading' | 'stale' | 'conflicting' | 'absent' | 'malformed' }
```

with a stable, HTTP-shaped **code** (small class layer + degrade-to-class, per RFC 9110 §15.1). Example
codes: `C201 unclear-tool-desc` (request), `C206 absent-required-arg`, `C505 malformed-tool-output`
(response — the gap no prior scheme codes), `C403 stale-memory`, `C204 conflicting-instruction`,
`C306 absent-retrieval`. CTXBUG's B1–B6 map straight on.

---

## Part A2 — The assignment rule (how a code is earned) — LOAD-BEARING

A code is **assigned in three tiers of certainty, and they must never be conflated.** This is the
honesty discipline that lets the taxonomy exist without overclaiming.

| Component | How it's obtained | Certainty | Surfaced as |
|---|---|---|---|
| **WHICH element** (localize) | influence score *ranks* → **ablation** *convicts* (remove it, re-run, outcome flips) | **proven** | **stated** |
| **SOURCE type** (request/response · instruction/fact/tool-output/…) | **read off the recorded provenance / custody** — the commit log already says who produced it | **known, not inferred** | **stated** |
| **MECHANISM** (misleading/stale/conflicting/malformed/absent) | **guessed** by inspecting the element's content, *bounded* by the confirming procedure (ablation-flips → present-but-bad; restoration-flips → absent) | **candidate, low-confidence** | **offered** (with evidence + confidence) |

**The score LOCATES, it does not CLASSIFY.** The influence score's only job is to reach the culprit
*element* fast (rank + skip the noise). It says nothing about *what type* the error is — the **source**
is recorded (free) and the **mechanism** is guessed (content). Do not let the score appear to assign a
type; it assigns *attention*, nothing more.

**Formal assignability criterion** (the upgrade that converts "cop-out" into a theorem):

> A code is **first-class** iff a *sound oracle exists at the runtime-owned boundary* (request: the
> tool contract; response: the output-field contract). It is **demoted to a candidate** iff assignment
> requires counterfactual restoration with no ground-truth oracle (stale / conflicting / absent /
> misleading-but-clear). The two-tier split is *derived from this criterion*, not asserted.

**Output contract (honest by construction):** **state** what's *proven* (the element), **state** what's
*recorded* (the source), **offer** what's *guessed* (the mechanism) — labeled as a guess, carrying its
*evidence* (the content that triggered it + the ablation/restoration result) and its *confidence* (the
`rankingConfidence` marker: decisive → a confident offer; flat cluster → "I can't separate these, here's
the shortlist"). The human confirms or refines the mechanism; each correction is a labeled training
signal. The system **never presents a guess as a fact** — the exact failure the whole thesis rejects.

> **Panel note (5-expert adversarial review, 2026-06-19 — see `ctxbug/docs/paper/research-notes-context-error-taxonomy-panel.md`):**
> survives review *only if repositioned*: **lead with the taxonomy (the detectability cut + this
> assignment rule), NOT the typed strategies** (Polly / SHIELDA / Self-Healing-Orchestrators-2606.01416
> subsume the registry). Scope it honestly as *"a detectability-and-assignability taxonomy for the
> subset of context errors that cross the tool-call boundary"* — in-context errors (poison /
> lost-in-the-middle) are out-of-scope-by-design, routed to the localizer + missing-context finder.
> Decisive deliverables: **E1** (two-number detectability report on CTXBUG B1–B6 — precision/recall +
> false-positive rate of the first-class codes assigned with *no LLM judge*, vs Who&When 14.2% on the
> demoted tier) and **E2** (annotate-before-read on the `_id` case — fire only when a field is
> undescribed *and* opaquely named, include a schema-drift case Spectral/MCP can't catch).

---

## Part B — Typed recovery strategies (the centerpiece)

A code is only useful if it tells you **what to do** — exactly as HTTP `503`→retry-with-backoff,
`400`→don't-retry-fix-the-request, `301`→follow-redirect. Each Contextual Error Type maps to a
default **strategy** (a remediation behavior), and the set is **pluggable** (a consumer registers
their own per code), with the library shipping sane defaults:

| Error type | Default strategy | Lifecycle |
|---|---|---|
| `unclear-tool-desc` / `unclear-arg` (request) | **DISAMBIGUATE** — sharpen the description (the fix is authoring-time); at runtime, re-prompt with the tightened text | build / runtime |
| `unclear-output-field` (`_id`) (response) | **ANNOTATE** — attach the field's description to the payload *before* the model reads it (or repair/reparse) | runtime |
| `stale` | **REFRESH** — re-fetch the source, drop the cached value | runtime |
| `absent` | **ACQUIRE** — fetch / restore the missing unit (read_skill, re-retrieve, ask) | runtime |
| `conflicting` | **RESOLVE** — apply declared precedence, or surface both and ask | runtime |
| `misleading-but-clear` | **DISTRUST** — flag + downweight + verify against an authority | runtime |
| `malformed-output` | **REPAIR** — reparse / coerce to schema, or treat as tool error | runtime |

The strategy layer is the actionability story. Two framings make it concrete:

- **Build-time strategies are the "lint + autofix."** `unclear-*` / `absent-arg` codes come from
  `toolContractCheckup` (request) and the new response checker (Part C); their strategy is a
  *description edit* a human (or an LLM via the description-doctor seam) applies before shipping.
- **Runtime strategies are an error-handling middleware keyed on the code.** When the localizer
  assigns a code mid-run (or post-hoc), the registered strategy fires — the same shape as an
  exception handler dispatching on type, or an HTTP client switching on status class.

```ts
// sketch — pluggable, defaults provided; consumer overrides per code
agent.onContextError('stale', refreshHandler)          // re-fetch
     .onContextError('absent', acquireHandler)          // restore / read_skill
     .onContextError('malformed-output', repairHandler) // reparse
// unhandled code → degrades to its CLASS default (RFC 9110 §15.1 fallback)
```

---

## Part C — Library design

A thin, additive layer over what already ships (the library is the product; the codes are the
*output schema* of the localizer, not a new subsystem):

1. **`ContextErrorType` / `ContextErrorCode`** — the taxonomy types (plain, relatable names per the
   public-API rule). Exported from `footprintjs`.
2. **Assignment, three honest tiers** (this honesty is *why* no prior taxonomy is assignable — they
   never separated "confirm by removing" from "confirm by adding"):

   | Tier | Codes | Producer (already shipped, except †) | Confidence |
   |---|---|---|---|
   | **Preventable at build** | request `unclear-*`, `absent-arg` | `toolContractCheckup` | high, static |
   | **Preventable at build** | response `unclear-output-field` | **† new response-field checker** | high, static |
   | **Assignable post-hoc** | `misleading` / `stale` / `conflicting` / `malformed` | `localizeContextBug` + **ablation** | bounded by slice honesty |
   | **Restoration-only** | `absent` | missing-context finder + **restoration** | separate path |

   The post-hoc code **inherits the existing honesty markers** — an overdetermined cause yields a
   *candidate* `code?`, never an overclaim.
3. **† The new buildable piece — a response-field-description checker.** The genuine gap the `_id`
   example surfaces: today nothing checks that a tool's *returned* fields are described. A static
   check (does each field in the tool's output schema carry a description the model can read?) is the
   response-side twin of `toolContractCheckup` — small, additive, and the one thing the literature
   confirms is uncoded anywhere.
4. **`ContextErrorStrategy` registry** — `onContextError(code, handler)` with library defaults; the
   typed-recovery layer of Part B.

### The data contract — the claim ladder as types (score-guess → ablation-confirmed)

The whole evaluation *arrives through a guess* (the score guesses where to look; ablation evaluates it),
so the two epistemic states get **two names sharing one base** — and the split makes each name *accurate*
(this also resolves the round-2 type-systems objection: `GuessedContextError` is genuinely a guess because
it is *pre-ablation*; the proven result is named `ConfirmedContextError`).

```ts
// ── SHARED base — both stages carry this ──
interface ContextErrorClaim {
  element: string;                 // WHICH element
  face: 'request' | 'response';
  source: ContextSource;           // recorded provenance — CERTAIN in both stages
  mechanism?: MechanismGuess;      // the guessed type — CANDIDATE in both stages
  evidence: Evidence[];            // ACCUMULATES across the score → ablation promotion
}

// ── SCORE stage: a ranked SUSPECT — the influence score's guess, not yet tested ──
interface GuessedContextError extends ContextErrorClaim {
  status: 'guessed';
  score: number;                              // the influence score that ranked it
  rankConfidence: 'decisive' | 'no-clear-winner';  // rankingConfidence — safe to skip straight to ablation?
  // NO proof — genuinely a guess
}

// ── ABLATION stage: PROMOTED from a guess after the counterfactual flipped ──
interface ConfirmedContextError extends ContextErrorClaim {
  status: 'confirmed';
  proof: { flips: number; samples: number };  // PROVEN — the counterfactual flipped
  code?: ContextErrorCode;                     // the classification — set ONLY when the MECHANISM is decisive
  strategies: StrategyOffers;                  // recovery attaches ONLY to a confirmed cause
}

interface MechanismGuess {
  type: ContextMechanism;                      // 'stale'|'misleading'|'conflicting'|'malformed'|'absent' ← guess
  evidence: Evidence[];
  confidence: 'decisive' | 'no-clear-winner';  // SEPARATE axis from rankConfidence (round-2 fix: never
  candidate: true;                             //   gate strategy auto-apply on the element-ranking's clarity)
}

type Evidence =
  | { kind: 'influence-score'; value: number }                 // LOCATED it — never classifies
  | { kind: 'content'; snippet: string }                       // the text that triggered the mechanism guess
  | { kind: 'ablation'; flips: number; samples: number }       // present-but-bad confirmation
  | { kind: 'restoration'; flips: number; samples: number }    // absent confirmation
  | { kind: 'annotation'; suggested: string };                 // a description-doctor fix offer

// invariant outer shape (round-2 fix — not a union on arity)
interface StrategyOffers {
  offers: StrategyOffer[];                     // length 1 when mechanism decisive; several when no-clear-winner
  confidence: 'decisive' | 'no-clear-winner';  // == mechanism.confidence
}
interface StrategyOffer {
  forMechanism: ContextMechanism;
  strategy: ContextErrorStrategy;              // REFRESH | ANNOTATE | ACQUIRE | RESOLVE | DISTRUST | REPAIR
  reversibility: 'reversible' | 'advisory-only' | 'destructive';  // round-2 safety axis
  candidate: boolean;                          // true if the mechanism it targets is still a guess
}
```

**The promotion is the pipeline + the rules:**
- `scoreInfluence` emits `GuessedContextError[]` (ranked suspects) → ablation tests the top one(s) → the
  survivor becomes a `ConfirmedContextError`. Same `ContextErrorClaim` spine; switch on `status` for proof.
- **Evidence accumulates** across the promotion: guessed = `[{influence-score},{content}]` → confirmed adds
  `{ablation: 3/3}`.
- **Strategies hang ONLY off `ConfirmedContextError`** — never auto-recover on an unproven guess. (A guess
  may still surface *advisory* offers, but never auto-applicable.)
- **Auto-apply gate (two axes, never conflated):** a strategy auto-fires **iff** `mechanism.confidence ===
  'decisive'` **AND** `reversibility !== 'destructive'`; otherwise it is offered for human confirmation.
  Plus a per-`(element, strategy)` budget + circuit-breaker (N re-fires → open → escalate human-only) so a
  decisive-but-wrong guess can never loop a destructive action.
- **Two confidence axes:** `rankConfidence` (is the *suspect* clear → skip to ablation?) and
  `mechanism.confidence` (is the *type* clear → one strategy or a menu?) are independent — the round-2 fix.

---

## Part D — Paper framing (after two adversarial review rounds — notes in `ctxbug/docs/paper/`)

**Survives review as an *honesty-boundary* contribution, not "a new taxonomy."** Round-2 verdict: it
crosses from "rejected as incremental" to defensible, *conditional on the experiments below*.

**Lead sentence (the sharpest claim, two rounds distilled):**
> *An influence score can soundly **LOCATE** which context element caused an agent's failure but cannot
> soundly **CLASSIFY** why — so we state the element as **PROVEN** (ablation), the source as **RECORDED**
> (custody), and the mechanism only as an explicitly-typed **GUESS**, drawing the first-class/candidate
> line by an **indistinguishability** result (two identical boundary traces, different true mechanisms),
> not asserted for convenience.*

**Claim / don't-claim:**
- **Claim:** the *detectability-first organizing principle* (cut by where a sound oracle exists at the
  runtime-owned boundary); the *honest two-tier confidence split* with a *formal assignability criterion*;
  the *one new code* `undescribed-output-field`; *library-assignability with no LLM judge* (the cheap,
  deterministic, high-precision subset nobody ships).
- **Do NOT claim:** "a new taxonomy of context errors" (it's a detectability *re-cut* of known categories —
  BFCL/CRITICTOOL/ToolScan); "novel typed recovery/registry" (SHIELDA / Self-Healing-Orchestrators
  2606.01416 / Polly subsume the mechanism); "comprehensive coverage" (Barnett/Breunig/Context-Rot own the
  in-context majority — **out of scope by design**); that detectability *equals* the request/response axis
  (present the 2×2 instead). Defer the word "theorem" until the indistinguishability lemma is proved.

**Must-cite (round-2 additions):** lead the locate≠classify spine with **SBFL / Spectrum-Based Fault
Localization** (validates it near-verbatim — a suspiciousness score locates, says nothing about fault
type); position the assignment rule vs **partial-label / hierarchical reject-option** + **Three-Way
Decision (Yao)**; the confidence gate vs **selective prediction / risk-coverage / ECE-AURC** (which demand
a calibration curve); the recovery half vs **SHIELDA** explicitly (or risk desk-reject).

**The strongest surviving objection** (state + rebut in the paper): *severity and classification-certainty
are anti-correlated even inside the owned boundary; the two certain tiers are near-tautological (element
proven by the ablation that defines ground truth; source read back from recorded custody).* Rebuttal lands
**only with numbers** — the severe-tier localization-lift (E3d) + the calibration curve (E3c) + reporting
the perfect-source number honestly as a *lossless-recording sanity check, not a learned win.*

---

## Part E — Phasing — **BUILD-AFTER-EXPERIMENTS** (round-2 recommendation)

**Gating deliverable first — corpus expansion + annotation.** CTXBUG today has *no* source/mechanism/
boundary labels, *no* recorded custody, and *no* request/response round-trip or `_id` family. E1/E2/E3 are
only decisive once these exist. This is the precondition.

**The decisive experiments (the two-number pairing *is* the paper):**
- **E1 — two-number detectability report on B1–B6:** precision/recall **+ FPR-on-negatives** (proves the
  oracle is *sound*, not just present) of the first-class codes assigned with **no LLM judge**, **+ the
  coverage denominator** (honest "we own a minority cheaply"); demoted-tier localization vs **Who&When
  14.2% step / 53.5% agent**.
- **E2 — annotate-before-read** on the `_id` case: misread-rate delta (N + CIs, temp 0 / seed 42); the
  **gated-oracle FPR** (fires only when undescribed *and* opaque-named — not on `customerEmail`); and the
  **schema-drift case** (passes MCP/Spectral, still triggers the code) — *E2's whole novelty, in the body.*
- **E3 — the assignment rule now demands it:** (a) source-from-provenance ≈100% as a *sanity check* on a
  *multi-loop* trace (a drop = the interesting finding); (b) mechanism-guess accuracy (honestly low, ±LLM
  judge); (c) **calibration of the confidence gate** (risk-coverage / AURC / selective-ECE — if "decisive"
  calibrates poorly, demote it too: the types already support graceful degradation); (d) **severe-tier
  localization-lift** (recall@k / median rank of `MechanismGuess`+evidence vs whole-context on
  poisoning/stale — makes "routed to the addressable quadrant" *true with numbers*).

**Build order once the corpus exists (each: propose → review → build, Convention 2/3):**
1. **Claim ladder as types + assignment** — `ContextErrorClaim` → `GuessedContextError` (score) /
   `ConfirmedContextError` (ablation); source from provenance; mechanism as candidate. Thin layer on the
   existing localizer. *(Cheap type + recovery-safety surgery — the `reversibility` axis, the budget +
   circuit-breaker, the two independent confidence axes — done here.)*
2. **Response-field-description checker (†)** — the `_id` gap (the one new build-time check; E2's subject).
3. **Typed-strategy registry** — `onContextError(code, handler)` + defaults; positioned as *substrate*
   (SHIELDA/Polly), with `annotate-before-read` as the one new verb defended by E2.

Scope discipline: assign only what the localizer can justify; resist a "governance/registry" (paper
narrative, not code). Defer "theorem" wording until the indistinguishability lemma is proved.
