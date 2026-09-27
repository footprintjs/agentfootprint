# Layer 1 · Choose a tool — the choice layer

**Stub, 2026-09-27. Nothing new is built.** The choice layer is step 9 of the plan, the last one.
This page holds its place in the folder and grows when step 9 starts. The design is
[the architecture note](README.md) § 3.1, and every design question was answered on 2026-09-27
([decisions.md](decisions.md)).

**Law.** The record says what was offered, what was left out and why, and which declared holder
was never consulted; the choice stays the model's.

Code is cited as `file · symbol`, as in the architecture note: paths are under `src/`, and
`findings/`, `stages/` and `coverage/` mean `src/core/agent/<folder>/`.

## What exists today

The architecture note § 3.1 lists it by clause:

- **Declare** — tool descriptions, `Tool.owner`, `Tool.argumentsFrom`; skill rules and scorers
  (`lib/injection-engine/routingPolicy.ts` · `decideTier2`); ontology `via` tools; the model's
  `_findings.basis` and `expect`, filed before the call (`findings/ledger.ts` · `recordFindings`).
- **Verify** — `core/slots/buildToolsSlot.ts` · `mergeWire`; `stages/toolCalls.ts` · `resolveTool`;
  the read_skill gate; `core/agent/validators.ts` · `validateToolNameUniqueness`;
  `integrity/invariant-violation/wire.ts` · `wireViolationsOf`.
- **Record** — `INJECTION_KEYS.TOOLS` (why each tool was offered); `AgentState.toolChoices`
  (`core/agent/toolChoice/record.ts` · `recordToolChoice`); the receipt.
- **Resolve** — refuse (permission, gate, unknown tool); narrow (`.toolChoice()`, `.skillGraph()`,
  `.ontology()`).

## What step 9 adds

- **Where it runs.** A subflow at the same mount as the inputs layer, just before it, because both
  read the same batch (architecture § 5.2). Mounted only under its own builder option, so a run
  without it is byte-identical. It needs step 1, the standing reader.
- **`source-not-consulted`** — a typed `tryInsteadTool` that was never called (shipped in 9.113.0,
  `coverage/types.ts` · `TryInsteadTool`, riding `agentfootprint.tools.absent`), or an ontology
  holder matched by declared aliases that was never called (`ontology/score.ts` · `scoreAbsence` is
  the bench-only precursor). It is the layer's reason in the standing fold (architecture § 4.2).
- **Recorded omissions.** `gatedTools`, `skillScopedTools` and `ledgerToolGate` drop tools with no
  record, so "not chosen" and "never offered" look the same today. An attention omission must be
  visible; a role-hidden tool stays unnamed (Lens law 1).

**Why it is last.** Its checks read declarations few tools make yet (a typed `tryInsteadTool`,
ontology source aliases), and its provoking cases overlap the honest-answer page's step 3, which is
on hold (architecture § 7, "Why this order").

**Gap left.** A tool cannot declare the subject kind it answers for. `resolves` / `argumentKinds`
are designed in the [honest-answer page](../2026-09-honest-answer-ledger.md) and on hold
([decisions memo](../2026-09-honest-answer-ledger-decisions.md) § 8.4).

## Its benchmark

The protocol is the architecture note's § 6.1. Provoking cases: wrong-kind entities, and a skill
picked for the wrong estate (the honest-answer page's field case F3). Baseline: the unarmed agent.
Every declaration the layer asks of the model (the basis) is measured for what it costs as well as
for what it catches.

## What the choice layer lets you measure

From the record alone: the basis declaration rate and the exploratory share per model; how often
the chosen tool is the declared holder of the question's term; the `source-not-consulted` rate;
offered versus chosen, with the omissions visible. The same rows feed the bench, the paper and the
lens. They measure claims within evidence, not whether an answer is true.
