# The findings ledger — facts, open questions and noise, kept apart (2026-09-16)

Status: IN PROGRESS. Steps 1 and 2 are shipped (the bench and its baseline;
the ledger on the record, 9.101.0 — see "Step 2 (2026-09-16)" below). Step 3
is its own packet, gated on the step-2 bench not moving. Tracked here; facts
found while building change this page.

## The problem, in the owner's words

A person working a task tries a tool, reads what came back, decides it is a
fact, a lead worth another tool, or noise, and moves on. After ten or
twenty of those the pile in front of them is large and the distinction is
in their head. When they sit down to answer, the first two facts are
clear, the rest is a blur, and a guess from step six reads exactly like a
fact from step two. Our agent loop has the same pile: every tool result
enters the served messages with equal standing, and the model must
remember, from its own earlier turns, which ones mattered. Findings get
lost incrementally, and hypothesis data and fact data tangle at the answer.

## What exists (read before designing)

- **Every tool result is on the record.** `scope.toolResults` holds one
  entry per dispatched call; the served messages carry each result as a
  `role: 'tool'` message; datasets can be minted as artifacts and handed
  to the model as references with their meaning.
- **Claims are judged at the end.** The Route decider keeps an integrity
  ledger, files a finding when the answer's claims disagree with the run's
  settled facts, and the `evidence-recheck` branch loops once to fetch
  what an answer needs. The catch is late: the answer is already drafted.
- **The vocabulary of a finding exists — in ContextFootprint.** Its
  `Assertion` is `{ subject: { kind, id }, predicate, value, epoch,
  stratum, provenance }`, and `conflictsOf(assertions)` returns the groups
  of incompatible current readings. It collects nothing and decides
  nothing; the host supplies the assertions. That is the exact shape of a
  ledger entry and the exact algebra of "not sure": two readings of the
  same subject and predicate that disagree.
- **The served-context vocabulary exists — in the context contract.**
  `facts` (with source and scope), `limitations`, `evidenceRefs` (need
  resolution), `nextSteps` (proposals). Those are the owner's three buckets:
  sure, not sure, still needed.
- **Eviction is by budget, not by standing.** When the context fills, turns
  are evicted by size; a noise result can outlive a fact.

## Prior art (checked 2026-09-16)

The three-bucket working memory is published: SLEUTH ("Track, Rank, Crack:
Epistemic Working Memory Scales Multi-Hop Reasoning in Language Agents",
arXiv 2607.12267, Jul 2026) keeps Confirmed Facts grounded to sources,
Active Hypotheses ranked by evidence, and Open Questions after every action,
by prompting plus a runtime check, and gains +5 to +11 points with task
difficulty. "From Agent Traces to Trust" (arXiv 2606.04990) types the
relations support / contradiction / invalidation between observations,
claims and answers. Recency effects in tool outputs are documented (arXiv
2510.15955; 2310.01427). What is ours on top: the selection BASIS declared
before the call and captured deterministically; the ledger as a replayable
RECORD with provenance refs, read at every stop by the Lens; ruled-out notes
with standing-aware eviction; the planted-noise bench. Paper-worthy as a
systems contribution with numbers; a patent needs counsel's search.

## The design

**One ledger, kept in the run's state, written as the loop runs.**

- **Basis, before the call.** Every tool request carries a declared
  selection basis — `direct` (this tool answers the question) or
  `exploratory` (this tool might; a hypothesis) — and an optional expected
  usefulness bucket (`low` / `medium` / `high`), a hint for review, never a
  score. The library records both BEFORE executing the call, so the record
  proves the declaration happened even though its content is the model's
  claim. Beside it, after the return, the recorded fact of whether the call
  brought what it sought (`sought: true | false`, the model's claim again),
  so a bucket can be judged against outcomes before any threshold exists.
- After each tool return, the model is asked for the findings that result
  supports — each an assertion in ContextFootprint's shape, with
  `provenance` = the tool result's identity on the record (its entry in
  `scope.toolResults`, and the artifact ref when the result was minted) —
  and one standing for the result:
  - `fact`: the result supports at least one assertion the model stands on;
  - `open`: the result suggests an assertion but does not settle it, and
    names what would;
  - `noise`: the result supports nothing for this task (kept as one line:
    tried, returned nothing useful);
  - `ruled-out`: an exploratory branch this result closes — the hypothesis
    was wrong; kept as one line naming what was ruled out, never the detour.
  The standing is the model's claim, recorded as such. The library never
  infers one.
- `conflictsOf` runs over the ledger's current assertions on every write.
  A conflict is a fact about the run, not an error: it goes in the "not
  sure" bucket with both witnesses, in their order.
- **The answer turn is served the ledger, not the pile:** facts with their
  refs, conflicts with their witnesses, open assertions with what would
  settle them, ruled-out branches as their one line, noise collapsed to its
  count. Disproven detours do not reach the answer; the record keeps them. The raw results stay
  on the record as artifacts, redeemable by ref — nothing is deleted, only
  not served. This is the context contract's `facts` / `limitations` /
  `evidenceRefs` / `nextSteps` filled from the ledger instead of by hand.
- **Eviction becomes standing-aware:** noise first, open next, facts last.
- **The Route decider's integrity ledger reads the same assertions**, so a
  claim in the answer that contradicts a ledger fact is caught with the
  same machinery as today, earlier.
- **The Lens shows the ledger at every stop:** an assertion entering,
  changing standing, joining a conflict — the Context view's since-marks
  over the ledger key, and a "Findings" band on the Why Lens.

## Where each piece lives

| Piece | Home | Why there |
|---|---|---|
| Assertion shape, `conflictsOf` | ContextFootprint (exists) | the pure algebra, no runtime |
| The ledger state key, the stage that asks for findings, the standing record, eviction order | agentfootprint | the loop and the record are here |
| The served form at the answer turn (ledger → contract fields) | agentfootprint, on the context contract's fields | the contract already names the buckets |
| The Findings band, since-marks over the ledger | agentfootprint-lens | the reader |

## Laws

- A finding is the model's claim with a recorded provenance; a standing is
  the model's claim; a conflict is the algebra's fact. None is inferred by
  the library.
- Served, never deleted: the pile stays on the record; the ledger is what
  the model sees at the answer.
- The bench decides. Before this ships, a checked-in bench: runs of ten to
  thirty tool calls with planted facts and planted noise, measuring how
  many planted facts reach the answer, and how many noise items are cited,
  with and without the ledger. No number is quoted before it exists. On a
  real model, the SHUFFLE test: the same evidence in shuffled order — an
  answer that drifts means the served ledger is not yet a sufficient
  statistic of the evidence.
- The instruction that asks for findings is a versioned artifact (the
  receipt already hashes every system piece) and the bench is its metric —
  a variant is proposed, the bench decides, the record says which version
  produced which answer. Nothing is tuned blindly (the borrowable half of
  DSPy's optimizers; the other half, scored fields, is
  docs/design/2026-09-scored-choice.md).

## The cut (one at a time, each shippable)

1. **The bench and the fixture runs** — planted facts and noise on the mock
   provider; the measurement harness; today's numbers as the baseline.
2. **The ledger on the record** — the state key, the findings request after
   each tool return, standings, `conflictsOf` on write (ContextFootprint
   as a dependency); the Lens shows the key like any other. No change to
   what is served yet. Measured: nothing should move.
3. **Served from the ledger** — the answer turn's context built from the
   ledger through the contract's fields; noise collapsed. Measured against
   the baseline: this is the packet that must move the number.
4. **Standing-aware eviction.** Measured on long runs.
5. **The Findings band in the Why Lens.**

## Worklog

Running notes, one line per task, newest last, in
`docs/design/2026-09-findings-ledger-worklog.md` — what was done, what the
reviews found, what moved on the bench, what is left. Read it before
touching any step.

## Open questions for the owner

- Who authors the standing when a tool result is a dataset reference
  rather than text: the model reads the reference's meaning, not the rows,
  so "fact" there means "this reference is the one I stand on". Fine, but
  it should be said.
- ~~ContextFootprint is in the other agent's line. Making agentfootprint
  depend on it is a decision for both lines.~~ RESOLVED (2026-09-16):
  agentfootprint already depends on `contextfootprint` 0.1.1 (published on
  npm) — `src/integrity/assertion/{types,conflicts}.ts` use it, and the
  release script has a packed-dependency gate for it. The ledger reuses the
  same assertion shape and `conflictsOf`; no new dependency.

## Track

- [x] design · [x] 1 bench + baseline (`npm run bench:findings`, `bench/findings-context.mjs`) · [x] 2 ledger on the record (9.101.0) · [ ] 3 served from the ledger · [ ] 4 eviction · [ ] 5 Findings band

## Baseline (2026-09-16, `bench/findings-context.mjs`, mock provider, 20 tool calls, a planted fact every 3rd)

| window | planted facts | facts present at the answer turn | noise results present | noise share of tool-result bytes | tool messages served | messages served (receipt) |
|---|---|---|---|---|---|---|
| none | 6 | 6 | 14 | 93.5% | 20 | 41 |
| sliding, keep 6 turns | 6 | 2 | 4 | 92.3% | 6 | 13 |

Read: without a window nothing is lost but the answer turn is served a pile
that is nine-tenths noise; with today's eviction, by recency, four of six
facts are gone before the model answers. Neither serves the facts and only
the facts. Step 3 must move both columns: facts present back to 6, noise
share toward the one-line count.

FACT for the bench's own shape: the bench is plain JavaScript on node,
importing the package's built doors by self-reference — under tsx's ES
module loader, footprintjs's `./trace` export resolved to its types file
(a packaging note for footprintjs: the `exports` condition order).

## Step 2 (2026-09-16) — the ledger on the record

Shipped in 9.101.0 as "ride-along findings": a reserved optional argument on
every served tool schema, peeled before anything else reads the call, filed
as one append-only `AgentState.findingsLedger`, read back with
`Agent.findings()`. Nothing is served differently. The spec of record is
`docs/design/2026-09-findings-ledger-spec.md`; the worklog carries every
fact found while building.

### The name, and the wires it was proved on

The reserved argument is `_findings` — a letters-and-underscore identifier
that is safe on every adapter, marked as the runtime's by its leading
underscore; bare `findings` collides with plausible author properties and
`$findings` wears the JSON-Schema keyword sigil. The name is public and can
never change once a model has seen it, so the proof landed BEFORE the name
did: `test/adapters/reservedArgumentSurvives.test.ts` shows the property
survives every provider's `inputSchema` mapping byte-for-byte, with
`required` exactly the author's and the served schema never mutated (the
fixture is deep-frozen; an in-place edit throws). Verified wires, as of
2026-09-16: Anthropic (`input_schema`), OpenAI (`function.parameters`),
Gemini (`parametersJsonSchema`), Bedrock (`toolSpec.inputSchema.json`),
Ollama (`function.parameters` on `/api/chat`), Foundry hosted (which
composes the OpenAI wire) and Foundry Local (its own wire), and the two
browser providers (the fetch twins of Anthropic and OpenAI) — nine wires
for the spec's seven names. A new adapter joins that file before it ships.

A tool that OWNS the name keeps it. A registry tool declaring its own
`_findings` is refused at build (`buildToolRegistry · assertReservedArgument`,
armed only); a provider- or MCP-ingested schema that carries it is served
undecorated (`withFindingsArgument` returns it by reference), and on a call
to that tool the model's value is the author's argument: the dispatch peel
(`toolCalls · peelCall`) asks the same predicate (`reserved.ts ·
ownsReservedArgument`) of the tool answering the name and leaves the value
in place — it reaches `tool_start`, middleware and `execute`, and files no
row. Review 2 of step 2 found the peel keyed on the arm alone (stripping an
author's argument the schema had promised); pinned by
`findings-ledger.test.ts` §13.

### The `standing` ruling

The word for what the model says a result IS to it — `fact`, `open`,
`ruled-out`, `noise` — is `standing`. `disposition` is taken:
`integrity/disposition/types.ts` owns it for the checker's own verdicts
(`checked-pass`, `checked-fail`, `not-applicable`, `unreachable`), and the
two must never share a name. This page's earlier sections said
"disposition" for the model's claim; they were aligned to the ruling on
2026-09-16. The library's other "findings" — `ContextError`s the Context
Integrity rail files through `core/agent/integrityFindings.ts` — are what
the LIBRARY detected; the ledger's are what the MODEL declared, and every
row names the call or answer that declared it.

### The stratum mapping rule

A ledger assertion is contextfootprint's `Assertion` through
`integrity/assertion/types.ts`, and its stratum is a DECLARED mapping, never
a reading of the value: `fact` → `asserted`; `open` and `ruled-out` →
`quoted`; `noise` → no assertions at all. Only a stood-on reading can
contradict: `conflictsOf` compares `asserted` rows alone, so quoted readings
stay out of the algebra by that rule and nothing else. `provenance` is
`tool:<toolCallId>`, or `artifact:<ref>` when the result was a placed ticket
(read through `artifacts/placement.ts · isPlacedToolResult` — the one
guarded parse, of a string the library itself minted; never a `ref` field on
`toolResults[]`). `epoch` is never set (the ledger is the unversioned
current world). A conflict row is written once per key from `conflictsOf`'s
output with witness identities only, at the write whose readings first
disagreed; the current conflict set is `foldLedger`'s recomputation, so a
later `ruled-out` retires a witness without rewriting a row. Two
disagreeing standings on one result are two rows, never a conflict — the
algebra sees assertions, not standings — and the LAST standing row per
`toolCallId` is the current reading.

### The no-outputSchema last-batch law

A standing rides on the NEXT tool call, or — when the agent has
`.outputSchema()` — as a top-level `_findings.previous` on the JSON answer,
peeled at both judge sites (`callLLM · postValidate` and the route's
`buildEnforcingDecider`) before the schema judges the content. The answer
that STANDS — every `final` — is the peeled JSON (`runTyped`, the claim
seam, the checkpoint's conversation carrier all read it); a RE-ASK exit
(`output-retry`, `step-nudge`, `evidence-recheck`) puts the emission back
first (`buildEnforcingDecider · reAsk`), so the assistant turn the retry or
nudge writes into history, and the rejected draft the evidence recovery
quotes, is the string the provider returned — reserved key and all — and
the next request echoes what the model sent. `outputAttempts` records the
verdict (the error names the shape, never the key), not the text. Review 2
of step 2 found the retry quoting the peeled form and ruled it a defect
against this law; pinned by `findings-ledger.test.ts` §11 and §14.
Without an output schema the answer is free text and there is no envelope,
so the results of the LAST batch have no standing: absent, recorded as
undeclared, never defaulted to `open` and never rendered as "no findings".
The bench below shows the law: twenty calls, nineteen results with a
standing.

### The refused synthetic tool

The one zero-extra-call structured channel for a no-schema answer turn
would be an optional `record_findings` tool appended at assembly and
harvested out of the reply like the forced output tool. It is refused, for
three breakages: (1) a reply that ONLY calls the synthetic tool becomes
`final` with empty content after `callLLM · singleProviderCall`'s filter —
the wrap-up's fragment failure in reverse; (2) Anthropic under
`parallelToolCalls: false` sends `disable_parallel_tool_use`, so the model
could not call it beside a real tool; (3) under the grouped chart the
harvest happens inside the call-llm subflow and would need a boundary
bubble. A wrap-up-style "ledger answer" branch in Route is refused with it:
one billed call per turn, replicated across four decider builders.

### Provider assumptions (stated; only the first is proved)

- A property inside `inputSchema.properties` passes through every adapter's
  mapping — the proof above, one case per wire.
- The model sees tool_result ids and can name them: every tool message the
  library serves carries `toolCallId`, and the assistant turn in history
  keeps `toolCalls[].args` verbatim, so a model re-reads its own
  declarations on the next call at no cost.
- Non-compliance yields absent rows and zero cost: a call without
  `_findings` is exactly a pre-9.101 call — no row, no event, no peel; a
  field that fails its enum check is dropped and counted
  (`BasisRow.malformed`), never coerced or defaulted.
- The mock SCRIPTS compliance. Every armed call in the bench declares
  because the script says so. Whether a real model declares, how often, and
  what the ask costs in output tokens are real-model numbers — the SHUFFLE
  run planned for step 3 — and nothing on this page quotes one.

### Bench — step 2 (2026-09-16, `npm run bench:findings`, mock provider, 20 tool calls, a planted fact every 3rd, sliding window keeps 6 turns)

Each configuration runs unarmed and armed (`.findings()`, the scripted calls
carrying `_findings`: a basis on every call; on every call after the first,
the previous result's standing — `fact` with one assertion for a planted
fact, `noise` for noise). The bench compares each armed row with its unarmed
twin and exits non-zero if any of the six baseline columns moves. As printed:

```
window           planted  facts-present  noise-present  noise-share  tool-msgs-served  receipt-msgs  calls-with-a-basis  results-with-a-standing  conflict-rows  extra-output-tokens  declared-chars
none                   6              6             14        93.5%                20            41                   -                        -              -                    -               -
none+findings          6              6             14        93.5%                20            41                  20                       19              0                    0            2562
sliding                6              2              4        92.3%                 6            13                   -                        -              -                    -               -
sliding+findings       6              2              4        92.3%                 6            13                  20                       19              0                    0            2562
step-2 law: the six baseline columns are unchanged under .findings() (none, sliding)
```

Read: the six baseline columns are the baseline's, to the digit, under both
windows — the step-2 law holds. `calls-with-a-basis` is 20 because the
script declares on every call; `results-with-a-standing` is 19 by the
last-batch law above; `conflict-rows` is 0 because the scripted facts never
disagree. `extra-output-tokens` is 0 by construction of the MOCK, not of the
feature: the mock's usage estimate (`MockProvider · buildResponse`) is
content chars / 4 and does not count tool-call args, which is where the
declarations ride — so the bench also prints `declared-chars`, the JSON
size of the `_findings` values the scripted calls carried (2562 over 20
calls), a count of the emission's own bytes, not a token price. The token
cost of the ask is a real-model number and is not quoted here.

### What the record holds

`test/core/tools/reference/agent-findings.json` is the one new byte-identity
reference (a basis on two calls, the first result's standing on the second,
a JSON answer carrying the second result's standing; a strict output-schema
parser that passes only because the key was peeled). The 15 references were
run on the 9.101.0 tree first and pass untouched; the new one was generated
alone and diffed path by path against its unarmed twin — every moved path is
the decoration, the ledger key and its trace rows, the `findings-ledger`
piece wherever a piece is recorded, the emission verbatim, the answer raw
then peeled, or the receipt's `requestMeasurement` sizes growing with them.
The whole delta is on the test file's header.

## Considered 2026-09-16 — typed judgments (an evaluation UI the owner shared)

- The pattern there: several independent yes/no + strength verdicts from one
  free text. Ours already asks typed enums (`basis` before the call, `standing`
  after). A strength per verdict is a SCORE: it stays gated on a provider that
  exposes scores (docs/design/2026-09-scored-choice.md) and is never the
  model's self-reported confidence.
- Borrowable, deferred to step 3 (not built in step 2): (a) a declared
  proposition before an exploratory call — one optional line under
  `_findings` naming what the call probes — so a later `ruled-out` names what
  was ruled out against a declaration made BEFORE the result; (b) the step 3
  served form grouped by proposition state: supported (facts with refs) ·
  ruled out (one line each) · unresolved (open, with what would settle it) ·
  noise as a count; (c) a bench arrangement with the failed exploratory calls
  concentrated at the END of the trajectory (the recency case) beside the
  every-3rd plant, and the SHUFFLE run on a low- and a high-reasoning model.

### Rulings after the second review (2026-09-16)

- A re-ask exit (`output-retry`, `step-nudge`, `evidence-recheck`) quotes the
  EMISSION: `buildEnforcingDecider · reAsk` puts the raw answer back before the
  turn is written into history or the rejected draft. The answer that stands
  (`final`) is the peeled JSON. One law, three doors.
- `Agent.checkpoint()` carries the answer that stands — the peeled JSON — as
  the conversation's assistant turn, the same value `run()` returns. The
  emission is on the record in `history`; a continued conversation echoes the
  answer, not the declaration. Not a defect.
- `PolicyHaltError.sequence` and the permission checker's `sequence` are
  derived from history, so their earlier entries carry the emission's
  `_findings` verbatim; only the proposed call (`proposed.args`, the
  committed `policyHaltArgs`) is the peeled carrier. History is the emission
  by law; the carrier is what would have run.
- The unsupported-argument check's enum fence reads the schema WITHOUT the
  library's decoration (`reserved.ts · withoutFindingsArgument`), so the
  reserved words (`direct`, `fact`, `noise`, …) never excuse a value on an
  armed tool; an author's own `_findings` property is not the decoration and
  is read as written.

