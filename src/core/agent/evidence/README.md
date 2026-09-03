# `evidence/` — names and numbers must come from a tool result

`.namesAndNumbersFromEvidence()` (9.35.0). Every number, identifier and name in
the model's final answer has to appear in a tool result the run actually read.
One that does not was **typed rather than read**.

## What it is not

**A fabrication detector, not a correctness judge.** It catches invented
values. It cannot catch a false claim assembled from real values — *"fc1/3 is
healthy"* when the data says the port is down uses entirely grounded tokens and
passes without a murmur. A reader who takes this for a hallucination check will
trust it for the one thing it provably cannot do, which is why the option is
not called `groundedness` and not called `hallucination`.

## The one non-negotiable property

**The check is deterministic.** Set membership over normalized tokens: no
second model, no embedding, no judge. The library's thesis is that structure
lets a smaller model perform like a bigger one, so a guard that needed a bigger
model to police the small one would invert the value proposition and would fail
exactly where the small model is deployed. That constraint is why the extractor
looks the way it does, and it is stated again at the top of `gate.ts`.

## Files

| file | one job |
|---|---|
| `types.ts` | the public vocabulary: posture, shape, options, verdict |
| `normalize.ts` | one spelling per value, on BOTH sides (`41,200` ≡ `41200`) |
| `extract.ts` | which tokens in an answer are DATA — the conservative rule |
| `evidenceIndex.ts` | the structural walk of tool results, and the exempt corpus |
| `gate.ts` | resolve options, judge an answer, write the sentences |
| `errors.ts` | `UnsupportedValuesError` — the `rails` refusal at the boundary |
| `index.ts` | the door: what the main barrel publishes |

Everything here is pure. The moving parts live in
`../stages/route.ts` (the judge, at the same seam `outputSchema` uses) and
`../stages/evidenceRecheck.ts` (the `guard` branch).

## The postures

Same three words as the skill-graph routing dial, a **separate** option:
routing authority and evidence discipline are different decisions.

| posture | what happens |
|---|---|
| `assist` (default) | record and flag; the answer goes out unchanged |
| `guard` | name the values back to the model, ONE revision, then flag |
| `rails` | the same one revision, then refuse: `run()` raises |

Every judgement lands on the emit channel as
`agentfootprint.agent.evidence_checked`, whatever the posture — that is where
per-attempt facts belong. Only the terminal verdict is committed
(`unsupportedValues`), because the boundary has to read it.

## Why `guard` is a Route branch and not a loop of its own

It is a sibling of the `output-retry` branch, built the same way, carrying the
same `{ loopTo }`: a correction is not a special mode, it is one more ordinary
turn of the ReAct loop. So the revision gets its own `iteration_start` /
`llm_start` bracket and its own `cost.tick`, and the tools are still on the
wire — the model can go and FETCH the value it guessed at. One revision per
turn, latched, because a model that cannot ground a value on its second try
will not ground it on its fifth.

## The extractor, in one paragraph

A token is data only if it contains a digit AND is distinctive: an identifier
(digits mixed with letters or `: _ - / .`, ≥4 chars) or a number of ≥4 digits.
Prose wearing a number is excluded — `32G`, `47th`, `48-port` and `$20/month`
are judged on their number alone, and `24/7` is a ratio. Values the user
supplied (their message, the conversation, the system prompt and skill bodies)
are exempt without being declared. Declared `shapes` are tested first and win.

The bias is deliberate: a missed fabrication is a miss, a false accusation
costs a real turn and can refuse a good answer. See `extract.ts` for the
justification of each clause, and
`test/core/agent/evidence-false-positives.test.ts` for the measured rate on
realistic SAN answers.

## What the corpus actually reaches, and WHEN it was read (9.83.0)

The evidence corpus is every `role: 'tool'` turn in `scope.history` **as it
stands at judgement**. Not "the whole conversation": `.window()` /
`.compaction()` / `tokenBudget` rewrite `scope.history` in place, so on those
agents this is the LIVE WINDOW and a result the window has dropped is not in it.

Until 9.83.0 the gate's two sentences — the correction sent to the model and
the warning printed to an operator — both said the flagged values *"appear in
no tool result FROM THIS TURN"*. The index has never been turn-scoped, so the
library was asserting a boundary it did not measure. Both now say what the check
really reaches ("no tool result this run read"), which is also the stronger
claim.

The boundary itself is now measurable rather than asserted: every indexed form
carries the turn that last served it, and
`AgentOptions.noticePriorTurnEvidence` (default OFF) reports the answer that is
grounded entirely in earlier turns as a `prior-turn-evidence` advisory at the
claim seam. It reports; it never revises or refuses — that stays `posture`'s
decision. See `src/integrity/prior-turn-evidence/README.md`.
