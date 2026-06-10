---
name: Regulated decisioning — one run, three compliance artifacts, offline auditor
group: features
guide: ../../README.md#features
defaultInput: Assess loan application APP-2209 for applicant A-1043
---

# Regulated decisioning — the compliance lighthouse

**The question this example answers:** *"Why was applicant A-1043 declined
three weeks ago?"* — answered weeks after the fact, by an auditor process
that loads **persisted JSON files only**. No agent, no provider, no LLM, no
re-run.

That is the record-keeping shape the EU AI Act asks of high-risk AI systems
(credit scoring is explicitly in scope, Annex III): Art. 12 requires
automatic event logging over the system's lifetime, and Art. 19/26 require
keeping those logs. A log you generate is not enough — you must be able to
show *what* the system did, *why*, and that the record *hasn't been altered
since capture*.

## One event stream, three artifacts

The agent run emits one typed event stream. Three observers consume it
simultaneously (each `agent.enable.observability({ strategy })` call
subscribes independently):

| Artifact | Produced by | Answers |
|---|---|---|
| **Audit bundle** (hash chain) | `auditExport()` (#20) | "Is the record complete and unmodified?" — `verifyAuditBundle` recomputes the chain offline and names any tampered record |
| **OTel GenAI spans** | `otelObservability()` (#19) | "What is happening right now?" — live dashboards, incl. decide() evidence span events |
| **Causal snapshot** | causal memory (#5) | "What did the agent say and do?" — query, final answer, every tool call with args + result preview |

Plus a fourth, example-level file: the **decide() evidence ledger** —
footprintjs's `FlowDecisionEvent.evidence` captured from the lending-policy
chart, recording *which labeled rule fired and the exact conditions*
(`dti gt 0.43 → 0.52 (true)`).

## What the decline run packs in

- **Labeled `decide()` rules** — the lending policy is a footprintjs
  flowchart mounted inside the `adjudicate_application` tool; the engine
  captures per-rule evidence (key, operator, threshold, actual value,
  result) as a side effect of traversal.
- **A permission denial** — the data-minimization policy denies
  `fetch_bank_statements` (`policyRuleId`, rationale, GDPR Art. 5(1)(c));
  the denial is itself an audit record.
- **A #9 validation rejection** — the model sends `credit_score` as a
  string; the call is rejected *before dispatch*, the model sees the typed
  issue list (`credit_score: expected integer, got string`) and corrects
  itself next iteration. Both the rejection and the retry are in the chain.
- **Per-turn evidence shipping** — `audit.drain()` after each turn produces
  consecutive segments that re-verify end-to-end; the causal snapshot is
  exported alongside.

## Non-repudiation: anchor BOTH ends

The hash chain is tamper-**evident**, not tamper-**proof**: an adversary
holding the only copy can recompute every hash from a mutation onward and
present a self-consistent forgery. The documented threat model
([docs/guides/security.md](../../docs/guides/security.md)) therefore says to
anchor **both chain ends** externally — here a second file (`anchor.json`)
stands in for a WORM bucket / RFC 3161 timestamp / second party:

- `finalHash` — pins the end of the chain (whole-suffix recomputation no
  longer matches);
- the **genesis identity** (`runId` + record-0 hash) — pins the start
  (head truncation is already hard-rejected by the verifier's
  `firstSeq 0 ⟺ zero-hash chainHead` invariant; the anchor makes it
  non-repudiable).

The auditor cross-checks both ends before trusting the narrative. Then the
demo moment: rewriting the permission denial's rationale in the stored file
("applicant consented to full statement review") makes `verifyAuditBundle`
name the exact record that broke.

## Honest limits

- **Bounded by default**: audit payloads carry key NAMES / types / `[N
  chars]` markers, not raw values (PII discipline). The *content* — prompt
  text, tool args and results, the final explanation — lives in the causal
  snapshot, which is **PII-bearing by design**: protect that store (and the
  evidence ledger) with access controls and retention policy. Verbatim
  audit payloads are an explicit opt-in (`payloadMode: 'verbatim'`).
- The anchor file in this demo sits next to the bundle; in production it
  must live somewhere the writer of the bundle cannot rewrite.
- A real deployment persists the causal store via
  `agentfootprint/memory-providers` (Redis/Postgres/Dynamo) instead of
  exporting `InMemoryStore` entries to JSON.

## Library follow-ups found while building this (reported, not hacked)

1. **Causal snapshots overwrite across turns** — FIXED since this example
   was built: `writeSnapshot` now derives the turn from the store
   (`max(turnNumber, maxStoredTurn + 1)`), so consecutive turns of one
   conversation persist `snap-1`, `snap-2`, … instead of a later turn
   silently replacing the earlier snapshot. The example still exports per
   turn — pairing each audit segment with its turn's snapshot is the
   cleaner evidence layout anyway.
2. **No recorder hook on `flowchartAsTool`** — ✅ SHIPPED since this was
   written: `flowchartAsTool` now takes
   `recorders?: ReadonlyArray<CombinedRecorder>` and attaches each entry
   to the tool's internal executor before every run, so decide() evidence
   reaches `otel.decisionEvidenceRecorder()` / the causal-evidence bridge
   directly. This example keeps its hand-mounted policy chart on purpose —
   it shows the manual wiring and the evidence-ledger tap end to end — but
   new code should pass `recorders` instead of hand-mounting.

Run: `npm run example -- examples/features/20-regulated-decisioning.ts`
