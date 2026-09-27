# Honesty layers — one structure over the model's decisions

**Design, 2026-09-26, revision 2. Adopted overnight 2026-09-27 on the owner's go; the owner may
overturn. Nothing in it is built yet: this folder is step 0 of its plan (§ 7).**

> **Status, 2026-09-27.** Every open question on the three design pages — this note's § 10, the
> inputs page's § 10 and § 10.1 (R1–R13), and the results page's § 10 — took its recommended
> answer. The 43 answers are in [decisions.md](decisions.md), numbered once across the three
> pages; wherever a page says "open question Qn", decisions.md holds the answer. The text below is
> the design as reviewed on 2026-09-26, with its file names and links updated for this folder.
> Step 0's row in § 7 also names a pointer in the repo's CLAUDE.md; that file configures every
> agent that works in the repo, so the pointer waits for the owner's own word.
>
> | Page | What it holds |
> |---|---|
> | [README.md](README.md) | this note: the layer contract, the four layers, the one ledger and the standing fold, the subflow layout, the benchmark protocol, the plan (steps 0–9) |
> | [decisions.md](decisions.md) | the owner's framing of 2026-09-26 and the 43 questions with their adopted answers |
> | [choice.md](choice.md) | layer 1 · choose a tool — a stub until step 9 |
> | [inputs.md](inputs.md) | layer 2 · fill its inputs — ask or assume, and where each value came from |
> | [results.md](results.md) | layer 3 · read a result — the three result doors, the period, the one emptiness reader |
> | [answer.md](answer.md) | layer 4 · give the answer — a stub until step 6; the fold itself is § 4 of this note |

- Written against agentfootprint 9.118.1 (on npm; its fix is `f83f277c` on main) and footprintjs 9.27.0.
- Code is cited as `file · symbol`. Paths are under agentfootprint's `src/` unless they start with
  `fp:` (footprintjs), `host:` (the host app that field-tests the library) or `study:` (the
  honest-answers study repo). The agent loop's own folders are written short: `findings/`,
  `coverage/`, `evidence/`, `stages/`, `toolChoice/` and the new `arguments/`, `assessment/`,
  `results/`, `honesty/` all mean `src/core/agent/<folder>/`.
- Revision 1 had five "stages". Revision 2 rebuilds the note around the owner's framing of
  2026-09-26 (four decision points, a layer over each, benchmark first, subflows mounted only when
  armed) and applies a four-lens review (engineer, devil's advocate, practitioner, research). Every
  finding that concerns this note was checked against the code on 2026-09-26. The accepted ones
  are woven into the text; the rejected ones are in § 9; the appendix maps each finding to where it
  landed. The companion note on the inputs layer (the arguments note, [inputs.md](inputs.md))
  keeps its own details; where the two differ, this note says which shape wins. In § 9 and the
  appendix, "the arguments note" means that page's revision 1. Its revision 2 proposes thirteen
  refinements to this note (its § 10.1, R1–R13); a consistency pass on 2026-09-26 marked each one
  where this note's text touches it, as "(arguments note Rn, …)", so the two notes no longer read
  as disagreeing. All thirteen were adopted on 2026-09-27 ([decisions.md](decisions.md), Q20–Q32).
- The results layer's page is [results.md](results.md); it owns the period rule and the one
  emptiness reader, and this note's § 3.3 and § 7 follow it.
- **One word, two meanings, kept apart.** In code, *standing* is the model's word on ONE tool
  result (`core/agent/findings/types.ts` · `Standing`). The whole answer's known / not sure / ask
  is its **assessment** in code (`assessAnswer`). In prose this note says "the answer's standing",
  as the owner does.

---

## For the owner

1. Every model decision — choose a tool, fill its inputs, read a result, give the answer — gets one honesty layer: the model declares its grounds, the library checks what it can, one ledger keeps the verdict, and the answer's standing is read back from that ledger, never from the model's confidence.
2. A declaration is worth only what the library can check. An unchecked one is filed as unverified and never trusted. A check that only finds matching words can show a claim is false, never that it is true.
3. The standing has four values: known (a row supports it), consistent with the record (checks ran, none fired), not sure or ask (a reason fired, and the reason is shown), not assessed (nothing could be checked).
4. Each layer is a small footprintjs subflow mounted only when armed: inputs just before Route (one check and one ask per batch — your "between CallLLM and ToolCalls"), results at the loop head (right after ToolCalls, where its loop lands), answer as the first node of the final branch (your "between Route 'final' and Final"). Nothing that exists moves.
5. The first new layer is inputs: per argument, the tool author says "ask the person" or "assume this default", and the record keeps where every value came from. The rules travel over MCP from the first step, because MCP is the host app's production path.
6. No layer becomes a default until its benchmark — provoking cases, a baseline without the layer, a rule registered in advance, Haiku only, your budget — shows a gain.
7. The ledger is also a measuring instrument: a per-model honesty profile read from the record alone. It measures claims within evidence, not truth.
8. Thirteen decisions wait for you (§ 10). The three that shape everything: the four-valued standing, what the ask rule does before model-declared sources exist, and the answer layer's place inside the final branch.

---

## 1. Why

Honesty features were added one at a time, each with its own arm, record and words:

- tools say what they covered (`core/agent/coverage/absent.ts` · `absent`, `coverage/ledger.ts` · `coverage`);
- the model files a basis for each call and a standing for each result (`findings/`, the reserved `_findings` argument);
- the evidence gate checks the answer's names and numbers (`core/agent/evidence/gate.ts` · `checkAnswer`);
- typed claims are checked against settled facts (`.claims()`, `integrity/unsupported-claim/`);
- limits travel with the answer (`coverage/answer.ts` · `composeAnswerWithCoverage`);
- the answer's own `_findings` is peeled in the Route decider (9.114.x, `findings/peel.ts` · `peelAnswerFindings`).

Nothing joins them into what the owner asked for: **every answer carries a standing — known, not
sure or ask — with its reason, and both are read from the record.** Two gaps show it:

- `lib/answer-account/facts/howSure.ts` still says "the whole-answer standing: NOT BUILT in v1".
- The arguments a call runs with are not checked at all. The host's VM performance tool defaults
  its window to `"2h"` and its I/O profile tool to `"24h"` (`host:py-tools/server.py` ·
  `real_vrops_get_vm_perf`, `real_influx_io_profile`). So "no errors" can mean "no errors in a
  window nobody chose".

The owner's structure: one **layer** per model decision, one contract every layer fills in, one
ledger for the rows, one fold that turns the rows into the answer's standing. Each layer then grows
in small steps, and each step earns its place with a benchmark.

### 1.1 The self-report caveat — stated first, because a reviewer attacks it first

A model's declaration is a claim about itself. Asking the model how sure it is, and printing the
answer, is confidence scoring, and it is what the paper uses as the baseline (§ 6.3). This design
does something else: it takes what the model SAID about its grounds — "the person said this", "this
value came from call_3", "this result is a fact" — checks each statement against the record, and
files the library's verdict beside it.

- **A declaration counts only as far as a check reaches.** Where no check reaches, the verdict is
  `unverified`. An unverified declaration is filed, shown, and never trusted.
- **Two kinds of check, and what each may prove.**
  - *Membership checks* ask whether words appear somewhere: a quote in the person's messages, a
    value in a tool result. A failure proves the claim false ("those words are not in any message
    the person sent"). A pass proves nothing: the words can be there by coincidence ("the 24h
    dashboard"), inside a negation ("not the last 24h — the whole week"), or in another sentence.
    **So a membership pass never counts as support for "known".** It can only keep a reason from
    firing.
  - *Tie checks* join a typed claim to a settled fact: a `.claims()` field that is
    `checked-pass`, or a passed enforce `AnswerValidationReport` for these bytes
    (`answer-validation/types.ts`). Only these support "known" — the honest-answer page's ruling
    ([2026-09-honest-answer-ledger.md](../2026-09-honest-answer-ledger.md) § 15, R3-11).
- **The verified rate is a copying measure.** When the paper reports how often the model's quotes
  and cited ids check out, it reports how faithfully the model copies, not how honest it is.

### 1.2 The trust base

Tool, app and person declarations are **trusted inputs**: `absent()` and `coverage()`, the period a
store says it holds, an author's default, the app's instructions, the person's typed answer. Model
declarations are **claims to check**. The standing is therefore only as honest as the trust base: a
tool that misstates what it searched produces an honest-looking standing. This is the bound the
integrity family already states: "Green means no registered check was violated. It does not mean no
context error exists" (`integrity/README.md`).

The study checks the trust base from outside the library: case truths are verified against the
seed at its G1 gate (`study:study/design-v1.md`), and the sealed side log keeps the declared result
for every call (`study:study/design-v2.md`, "The sealed side log"). The paper reports wrong
declarations as a threat to validity.

---

## 2. The layer contract

### 2.1 Seven clauses, on the owner's canon

Map – Walker – Trace – Fold – Lens ([map-walker-trace-fold-lens.md](../map-walker-trace-fold-lens.md)). Inside each
layer's subflow the stages run in the owner's order: **Declare → Verify → Record → Resolve**. Fold,
Serve and Arm describe how the layer's rows are read, shown and switched on.

| # | Clause | Role | Every layer must say | Law |
|---|---|---|---|---|
| 1 | **DECLARE** | Map | Who declares what, as data, before the walk: the tool author (on the `Tool`, and over MCP in `_meta.agentfootprint`), the app (builder or run options), the model (the reserved `_findings` argument), or the person (only through a typed ask). A malformed declaration is refused at definition, again at dispatch and at MCP ingest, and never repaired. | A model declaration is a claim, never evidence. |
| 2 | **VERIFY** | Walker | What is checked, on which value, with which deterministic test (membership, lookup, comparison). A classifier is only a second reading, filed apart (`findings/judge.ts`). | Membership can refute, never support. Library-authored text is never evidence for a value. |
| 3 | **RECORD** | Trace | Its row kinds on the one ledger, returned through the layer's output mapping, once per run of the layer. Events carry names, enums and counts. Values and quotes live only in the committed row, through the tool's own argument view (`core/toolShownArgs.ts` · `shownArgsOf`). | Written during the walk, never rebuilt. |
| 4 | **RESOLVE** | Walker | Its verbs: **ask** (a typed ask and a pause — only where the call has not run yet), **assume** (fill a declared value and record it), **refuse** (the call does not run; the model gets a past-tense correction), **flag** (it runs; the row carries the reason). | The library acts only on declarations and never writes the model's reply. |
| 5 | **FOLD** | Fold | The reasons it adds to the answer's standing, and which of its rows can SUPPORT "known" (almost none can). | Derived, never stored; one pure function for the running agent and every later reader. |
| 6 | **SERVE** | Lens | Up to three views: the model's request (a schema sentence, a past-tense note on a result), the person (the typed ask; the standing as data on the result and on events; prose only under an opt-in arm), and the lens (the rows). | Omit, never deny; each model-facing clause tied to its call. |
| 7 | **ARM + MEASURE** | — | What switches it on, and its benchmark. A tool declaration may serve bytes only inside that tool's own schema and results (the `resultCeiling`, `wants` and skill `steps` precedents). Anything else that is served needs a builder option. When off, runs are byte-identical to `test/core/tools/byte-identity.test.ts`. | Zero cost when undeclared. Kept only if its benchmark shows a gain. |

Revision 1's clause 7 said a tool declaration arms only "checks that serve no new bytes". The
shipped precedents already serve bytes inside the declaring tool's own contract, so the clause now
says what the code does.

### 2.2 Laws every layer keeps

1. **A model declaration is never support.** `basis`, `expect`, a standing, `_findings.from`: the
   fold may compare them with the record, never count them as evidence.
2. **The library acts only on a declaration.** It never infers a rule, a default or a question.
   When it looks a value up on its own, the result is a hint for the lens and the bench, never a
   source (layer 2, `coincides`).
3. **"The person said it"** means `lib/saidByPerson.ts` · `isSaidByPerson` accepted the message, in
   a run whose message the caller passed as a person's. Composed patterns pass model-written text as
   the run's message (`patterns/Reflection.ts` · `reflection` sends "Proposal to critique: …"), so
   they mark their runs, and in a marked run a quote from that message is filed as `judged`, not
   `said` — on the row, source `model` with `failed: 'composed-message'` (arguments note R3,
   adopted 2026-09-27).
4. **Library-authored text never grounds a value**: not the frames `isSaidByPerson` excludes, and
   not the notes the library appends to a tool result (layer 2 explains the laundering this
   prevents).
5. **The library never writes the model's reply.** It may append labelled text built from rows by
   versioned templates, and only under an opt-in arm (the `composeAnswerWithCoverage` precedent).
6. **A layer is a subflow mounted only when armed.** It is not a new loop moment:
   `core/agent/moments.ts` · `LOOP_MOMENTS` stays at five.
7. **Every served sentence is registered** in `test/modelFacingSurfaces.test.ts` and passes
   `unprovable`: it says what the model may do and what the record keeps, and promises nothing a
   later path can break.
8. **Tool and app declarations stay in their own keys; model declarations and library verdicts are
   ledger rows.** (Revision 1 said "declarations stay in their own keys", which the ledger's own
   basis and standing rows — the model's declarations — already contradict.)
9. **Reads are value-conditional.** A layer reads a scope key only when a run constant says the key
   can exist. A tracked read of a key a run never writes is a phantom context source
   (`core/agent/window/evictedTurns.ts`, header).

---

## 3. The four layers

| Layer (decision) | The model declares | The library checks | Exists | New in this plan | Gaps left |
|---|---|---|---|---|---|
| **1 · Choose a tool** | `_findings.basis` (direct / exploratory) and `expect`, before the call | the offer, the name, the gates; later, declared holders never consulted | offer record, `.toolChoice()`, skill routing, ontology `via` tools, the read_skill gate | recorded omissions; `source-not-consulted` (last step) | the subject kind a tool answers for (on hold) |
| **2 · Fill its inputs** (the arguments layer) | where each value came from (`_findings.from`) | the value's source; missing values; the author's rule | shape validation, `unsupported-argument`, `contingent` | the whole layer: ask-or-assume per argument, declared sources, the batch ask | nested arguments; absolute compound windows (stay app code) |
| **3 · Read a result** | a standing per result (`_findings.previous`) | the tool's declared coverage and period; the model's reading against the result it cites | `absent()`, `coverage()`, `semantic()`, the findings ledger, `contingent`, `unsettled` | `describedResult()`; the one period shape and its verdict; fact-in-result; one outcome row per call | a result from a tool that declares nothing |
| **4 · Give the answer** | the answer's `_findings` (peeled in Route) | names and numbers, typed claims, the answer contract | the evidence gate, `.claims()`, `.answerValidation()`, the limits block, the answer peel | the standing fold; the answer layer; committed witness rows for verdicts that are events only | "no errors" and small numbers are never checked |

Each layer below closes with **what it lets you measure** (owner item 4).

### 3.1 Layer 1 · Choose a tool

**Exists.**
- *Declare:* tool descriptions, `Tool.owner`, `Tool.argumentsFrom`; skill rules and scorers
  (`lib/injection-engine/routingPolicy.ts` · `decideTier2`); ontology `via` tools; the model's
  `_findings.basis` and `expect`, filed before the call (`findings/ledger.ts` · `recordFindings`).
- *Verify:* `core/slots/buildToolsSlot.ts` · `mergeWire`; `stages/toolCalls.ts` · `resolveTool`;
  the read_skill gate; `core/agent/validators.ts` · `validateToolNameUniqueness`;
  `integrity/invariant-violation/wire.ts` · `wireViolationsOf`.
- *Record:* `INJECTION_KEYS.TOOLS` (why each tool was offered); `AgentState.toolChoices`
  (`core/agent/toolChoice/record.ts` · `recordToolChoice`); the receipt.
- *Resolve:* refuse (permission, gate, unknown tool); narrow (`.toolChoice()`, `.skillGraph()`,
  `.ontology()`).

**New (the last layer in the plan, § 7 step 9).** A subflow at the same mount as the inputs layer,
because both read the same batch:
- `source-not-consulted`: a typed `tryInsteadTool` that was never called (shipped in 9.113.0,
  `coverage/types.ts` · `TryInsteadTool`, riding `agentfootprint.tools.absent`), or an ontology holder
  matched by declared aliases that was never called (`ontology/score.ts` · `scoreAbsence` is the
  bench-only precursor).
- Recorded omissions. `gatedTools`, `skillScopedTools` and `ledgerToolGate` drop tools with no
  record, so "not chosen" and "never offered" look the same. An attention omission must be visible;
  a role-hidden tool stays unnamed (Lens law 1).

**Gap left.** A tool cannot declare the subject kind it answers for. `resolves` / `argumentKinds`
are designed in the honest-answer page and on hold
([2026-09-honest-answer-ledger-decisions.md](../2026-09-honest-answer-ledger-decisions.md) § 8.4).

**What it lets you measure.** The basis declaration rate and the exploratory share per model; how
often the chosen tool is the declared holder of the question's term; the `source-not-consulted`
rate; offered versus chosen, with the omissions visible.

### 3.2 Layer 2 · Fill its inputs — the first new layer

**Law: no argument runs unaccounted for.** Every value on an argument the tool author ruled is one
of: the person's (their words, or their answer to the library's ask), a tool result's, the app's,
or a default the library filled and the answer admits. When none of these holds, it is recorded as
the model's own, and the answer's standing says so.

#### (a) What the tool author declares — `askOrAssume` (name open)

```ts
defineTool({
  name: 'search_logs',
  inputSchema: {
    type: 'object',
    required: ['service', 'window'],
    properties: {
      service: { type: 'string' },
      window: { type: 'string', enum: ['1h', '2h', '24h', '7d'] },
    },
  },
  askOrAssume: {
    window: {
      ask: 'Which period should the error search cover?',
      choices: [
        { value: '24h', said: ['last 24 hours', 'past day'] },   // phrases the author vouches for
        { value: '7d', said: ['last week', 'past week', 'last 7 days'] },
        '1h',
      ],
    },
    // or: window: { assume: '2h' },
  },
  period: { argument: 'window', spelling: 'lookback' },          // the one period shape, § 3.3
  execute: async ({ service, window }) => searchLogs(service, window),
});
```

- **`ask`** — a missing value is asked of the person before the call runs, with the author's
  question and the author's choices. The ask never carries the model's value or the model's choices
  ([decisions memo](../2026-09-honest-answer-ledger-decisions.md) § 8.4: "the typed ask carries
  the model's guess when the model writes the choices"). Whether a *present but unverified* value is also asked depends on the sources arm
  (table (d)).
- **`assume`** — a missing value is filled by the library, not the tool, and recorded as assumed.
- **`said` on a choice** — phrases the author declares for that choice. The library matches them
  as whole tokens, the ontology source-alias precedent, and only inside a quote the model declared:
  it never scans the person's words for them on its own. This is how "last week" can check out as
  `7d` with no phrase parsing.
- **No rule** — the argument is free.

The name is `askOrAssume`, not revision 1's `whenMissing`, because `ask` also fires on a value that
is present but untraceable once sources are armed (devil's review). Other names are open (§ 10).

**Refused at definition** by `arguments/declare.ts` · `assertAskOrAssume`, called from
`core/tools.ts` · `defineTool` (which copies fields one by one, so it must also copy this one):
- the argument is not in `inputSchema.properties`, is not a string, number, integer or boolean, or
  is a `wants` argument;
- a rule has both `ask` and `assume`, neither, or an unknown key;
- the question is blank or over 4096 characters; `choices` is empty, has more than 100 entries, or
  holds a value outside the property's `enum`;
- the `assume` value or any choice fails **the property's own schema** (`inputSchema.properties[arg]`,
  through the node validator). Not `toolArgsValidation.ts` · `validateToolArgs` on
  `{ [arg]: value }`: that enforces the root `required`, so it would refuse the example above for
  its missing `service`;
- more than 32 arguments carry `ask` (the typed ask's field limit);
- a `period` names an argument with no rule (so a `ToolPeriod` never arms anything alone — open
  question Q19).

The same rules run again at dispatch (a Tool built by hand or by a ToolProvider never passes
through `defineTool`) and at MCP ingest.

**Over MCP from the first step.** The host's production tools arrive over MCP: its service unit
turns the MCP path on, its catalog replaces each local binding with the served tool
(`host:src/mcpCatalog.ts`), and declarations come from `host:py-tools/tool_metadata.py` ·
`TOOL_EXTRAS` through `host:py-tools/mcp_server.py`. A layer that left MCP tools free would do
nothing there. So step 3 adds `askOrAssume` and `period` to `lib/mcp/toolExtras.ts` ·
`McpToolExtras`, validated on ingest by the same exported assert and dropped with a warning when
malformed, like every other extra. They pass that file's bar — "a declaration a consumer-side check
or rail reads; nothing that governs execution" — because the ask and the fill happen in the
client's own loop before the call is sent, exactly as the client serves a `resultCeiling`
refusal. The result half (the `period` on an envelope) travels in the result itself; the host's
Python helpers mint it (§ 3.3).

#### (b) What the model declares — `_findings.from` (armed by `.findings({ argumentSources: true })`)

The shape from the arguments note (an array, one pattern with `previous[]`) wins over revision 1's
object map:

```json
"_findings": {
  "basis": "direct",
  "from": [
    { "argument": "service", "source": "user", "quote": "errors on checkout" },
    { "argument": "window", "source": "user", "quote": "over the last week" },
    { "argument": "host", "source": "result", "id": "toolu_01AbC" }
  ]
}
```

- Sources: `user` (+ `quote`, the person's words copied exactly), `result` (+ `id`), `turn` (an
  earlier turn settled it), `app`, `assumed`.
- **Planted only on tools that declare a rule or a period.** `findings/reserved.ts` ·
  `withFindingsArgument` decorates every served tool today; the review measured the drafted `from`
  schema at about 611 characters, so planting it on every tool would cost thousands of tokens per
  call before any benefit is measured. The step-5 bench sets a token ceiling before the arm can be
  recommended.
- **Read by the one reader.** `findings/reserved.ts` · `readDeclaration` gains `from` and counts a
  `from`-only `_findings` as readable. Today `readable` covers basis, expect, proposition, predicts
  and previous only, so a `from`-only declaration would be dropped. When no basis row exists, the
  malformed count is filed on the argument rows.

#### (c) What the library checks, for every call in the batch

The checks run in the inputs layer's Verify stage, before anything dispatches. Each is a membership
test over whole tokens, using the evidence module's definition of "the same value"
(`evidence/normalize.ts` · `tokenize`, `canonicalForm`) — one owner, no extractor, so "2h" and
plain words can be checked.

- **`user` + quote.** The quote's tokens must occur, in order and adjacent, in a person message
  (this turn or an earlier one, within the window). Then:
  - the value occurs inside the quote → `said`, `matched: 'quote'`;
  - the quote holds a phrase the author declared for that choice → `said`, `matched: 'phrase'`;
  - the quote is found but the value is not in it → a **reading** (`said` + `reading: true`, the
    words and the value both kept). Under `ask` a reading **asks**, with the quote shown to the
    person as context; elsewhere it flags. Revision 1 let a reading run, which let any exact
    fragment of the person's message carry any value past an `ask` rule (devil's review, a
    MUST-FIX).
- **`result` + id.** The id must resolve (`findings/offer.ts` · `knownResults`) and must not be a
  placement ticket. The value must occur in that result's **tool-authored content, read the way the
  evidence index reads a result**: parse, apply `coverage/evidence.ts` · `absenceEvidenceProjection`
  (so an absence's `looked_for` never grounds), walk the leaves, fall back to text. That routine is
  `evidence/evidenceIndex.ts` · `indexResult`, exposed as one per-result function — never a second
  haystack. Running `tokenize` over the raw JSON string would be wrong: checked on 2026-09-26,
  `tokenize('{"host":"srv-4417","limit":50,"ok":true}')` yields `:50` and `:true`, so every number
  and boolean in compact JSON would fail as `not-in-result` — a false accusation. The model's current
  standing on that result is joined: open, noise or ruled-out → `setAside` (the contingent law, for
  any value from any turn).
- **`turn`.** Resolves only to an earlier turn's `answered` row (the ledger carries them, § 4.1) →
  `answered` + `earlier`. A value the library merely finds in earlier person words, results or app
  text is a hint (`coincides`), never a source — law 2; to be verified, the model quotes the words
  (`user`) or names the result (`result`) (arguments note R1, adopted 2026-09-27). Assistant text alone
  never counts (`only-in-model-answer`).
- **`app`.** The app corpus (the reach of `evidence/evidenceIndex.ts` · `exemptFromRun`, minus the
  person's turns — which includes memory recall and retrieval passages, stated), or an
  `AgentOptions.externalGrounds` value, or — once the declared-control page's capability 1 ships —
  a run fact `given` (`docs/design/2026-09-declared-control.md`, a page not yet in the repo), with
  its label kept as `appSource`.
- **`assumed`, or nothing declared** → `model`. The library may still look the value up itself; a
  hit is recorded as `coincides: 'person' | 'result' | 'app'` — a hint for the lens and the bench,
  never a source, never support, and never enough to skip an ask. The arguments note turned such a
  hit into `said` (its "C6"); a person who wrote "we have 7 hosts" would then have "said"
  `days: 7` (engineer and research reviews).
- **A failed claim** keeps what was claimed and which check failed. It is never repaired and never
  resolved by position (the `unknownId` precedent). The value is still looked up as a hint, so a
  misquote with a correct value shows as exactly that.

**Library-authored text never counts.** Not the frames `isSaidByPerson` excludes, and not the notes
the library appends to a tool result. The layer's own note ("the call ran with "2h", the tool's
rule's default") sits in the served tool message; if the result haystack included it, the next call
could cite that result as the source of "2h" and turn an assumption into an observed value
(engineer review, a MUST-FIX). The result haystack therefore stops at the tool's own bytes: a
framework field on the committed tool message records where the tool's text ends, stripped from the
wire by `composeRequest.ts` · `stripFrameworkFields` like `notDispatched`. Step 3 builds it, because
its note is the first library-authored text that carries a value, and the evidence index reads
through it from then on; step 5's source checks reuse it. It is present only on a message the layer
annotated, so every existing run indexes exactly what it did. The value stays in the note, because
the model needs it to reason.

#### (d) Resolution — one table, applied only to a batch that will dispatch

The layer resolves a batch only when Route's own predicate says the batch will dispatch.
`stages/route.ts` · `decideBranch` picks `tool-calls` only when there are calls AND the run is not
out of iterations AND no halting cost budget fired. That test is lifted into one exported pure
predicate over the five values it reads, which `decideBranch` itself calls and the layer asks too
(arguments note R13, adopted 2026-09-27 — the layer's isolated scope cannot hand Route's scope to
`decideBranch`), so the layer never asks the person about a batch that Route then sends to the
final branch.

| The value | `assume` rule | `ask` rule, sources **unarmed** | `ask` rule, sources **armed** | no rule |
|---|---|---|---|---|
| missing | fill → `default` | **ask** | **ask** | nothing |
| present, verified (`said` via quote or phrase, `answered`, `result`, `app`) | run | run | run | run; a row only if `from` named it |
| present, unverified (undeclared, `assumed`, a failed claim, a reading) | run, flagged | run, flagged — **open question Q2** | **ask** | run; a row only if `from` named it |

**Why the unarmed cell flags instead of asking.** The owner's decision (b) says an unverified value
on an ask argument triggers the ask. With sources unarmed, the model has no way to say where a
value came from, so every present value is unverified and the ask would fire on nearly every call —
including when the person already said the period in words. The spellings rarely meet: `tokenize`
keeps `-24h` and `24h` apart and splits "24 hours" into two tokens (checked 2026-09-26). The host
already met this in its own flow: its collecting tool's description warns that calling it "asks the
person for something they already gave" (`host:be-server/queryWindowFlow.ts`). So this note asks
on a present value only once sources are armed (step 5), and the step-4 bench measures the
needless-ask rate before anything else is decided.

#### (e) The ask — once per batch, before anything dispatches

- **One typed ask per batch** for everything missing or unverified, accepted by
  `core/inputRequest.ts` · `validateInputDeclaration`: a fixed library question, and one field per
  distinct (tool, argument) with the author's question as the field's `description` and the
  author's choices as its `enum`. The answer binds to every call in the batch that needed that
  field. A fixed question keeps the total inside the 4096-character bound, which a joined question
  could break at pause time (engineer review).
- **Field ids are positional** (`f1`, `f2`, …), with the (tool, argument, calls) list in `context` —
  never a joined `tool.argument` string, which two different pairs could spell the same way (the
  injective-key law in agentfootprint's CLAUDE.md).
- **The pause** is a pausable stage inside the layer's subflow. footprintjs carries a paused
  subflow's state in the checkpoint (`fp:test/lib/pause/subflow-scope-resume.test.ts`), and
  `Agent.resume` takes the typed-input path (`readAwaitingInput` → `applyInputResponse`: types and
  enums checked, nothing coerced, a partial answer pauses again). A batch ask has no single call, so
  the stamp names the batch's first asked call and `context` lists the rest (a named change to the
  stamp in step 4).
- **The resume** binds the values, stages `answered` rows (emitting their events, as the Record
  stage did for the rest) and completes the layer. An answer that fails the property's own schema
  is not bound and is asked again, at most three rounds, then the calls that needed it are refused
  (arguments note R4, adopted 2026-09-27). Route then sends
  the completed batch to ToolCalls, which dispatches it through its normal path. Two things follow:
  - nothing in the batch ran before the pause, so there is no batch to settle;
  - ToolCalls' normal path can still pause afterwards — a tool's own `requestInput`, a check-in, a
    credential consent — because footprintjs lets a later stage pause after a resume
    (`fp:test/lib/pause/resume.test.ts`, "second pause at review"). The per-call design had to
    refuse those, because a resumed dispatch has no second checkpoint.
- **A host that keeps its own state across pauses.** The host puts its routing step in the ask's
  `context` and restores it on resume (`host:be-server/brain.ts` → `host:be-server/routing.ts` ·
  `restoreInputPause`). A library ask would lose that. Step 4 adds one hook (`argumentAskContext`,
  name open) or states plainly that such a host checkpoints its own state and recognises a library
  ask by its marker.

**The cost of this placement, stated.** The ask happens before ToolCalls' permission check and
before-tool middleware. A call that permission then denies has asked the person for nothing: the
`answered` row stays and the call is denied as today (open question Q4).

**Where the filled values enter the call.** ToolCalls applies the layer's fills after `tool_start`
(which keeps the model's proposal) and before the permission check, so policy judges the call that
will really run and a person's answer can never slip past an argument policy. `changedArgKeys`
then names every filled key on `tool_end`. The fill builds a fresh object and never edits `tc.args`,
which is the assistant message's own object when `.findings()` is off. A before-tool middleware
that rewrites a ruled argument after the layer checked it is recorded on `middlewareDecisions`
(key names only, a small addition), and the fold reads that value as assumed unless the middleware
declares where it came from (open question Q8). A middleware default must not earn more standing
than the same default declared as `assume` (practitioner review).

#### (f) Assume, and carrying the assumption with the answer

- The library writes the default, never the tool. The row is `source: 'default'`.
- The served result gains one past-tense note tied to its call: *window was not in the
  search_logs call this result answers; the call ran with "2h", the value the tool's rule assumes —
  recorded as assumed, not as the person's.*
- The answer carries the assumption **as data first**: the rows, an event carrying names and enums,
  and a field on the run's result (step 6). The host dropped the appended limits block on the
  owner's 2026-09-18 ruling — "the boundary is the reader's, drawn in the lens" — and shows counts
  it reads from events (`host:be-server/coverageMark.ts`). A host can count "1 assumed" the same
  way.
- **Prose only under an opt-in arm.** Under an existing `.limitsTravelWithTheAnswer()`,
  `composeAnswerWithCoverage` takes the default rows as a second input (*Assumed (a tool's rule,
  not your words): window = "2h" (search_logs)*). With neither coverage rows nor default rows the
  answer is unchanged. From step 6 on, the standing line owns the "assumed" sentence whenever both
  arms are on: one composer for one fact (devil's review).
- PrepareFinal reads the default rows only when the run constant says a ruled tool is registered
  (law 9). `stages/prepareFinal.ts` · `prepareFinalWithLimitsStage` reads `coverageDeclared` with no
  such guard today, and none of the 21 byte references arms the limits block, so step 3 adds a
  reference that does (devil's review).
- The "2h" in the library's note grounds nothing (law 4). A declared default is the app's own
  declaration, so the evidence gate treats it as exempt, like a value in the system prompt; if the
  tool's own result echoes "2h", that echo grounds it as today (§ 8). The fold says who chose it.

#### (g) What the model is served

The served copy of a ruled tool's schema drops the ruled arguments from `required` and adds one
sentence to each ruled property. The copy is rebuilt per request at the one decoration site and its
seed twin; the registry schema — which `validateToolArgs` judges and `mcpServe` serves — is never
edited. Revision 1's sentences promised outcomes that other paths break ("waits for the person's
choice before it runs" is false when permission denies the call or inner dispatch refuses it), so
the sentences now say only what the model may do and what the record keeps:
- *ask:* "The tool's rule asks the person for this value; leave it out unless the person gave it."
- *assume:* "If left out, the tool's rule fills "2h", recorded as assumed."

Both are registered in `test/modelFacingSurfaces.test.ts` at the strictest lifetime. The notes on
results are past tense and tied to their call (Lens law 2).

#### (h) The row

`arguments/rows.ts` owns the type, the builder and the well-formedness check. `findings/types.ts` ·
`FindingsRow` imports it. **`arguments/` is a leaf: it never imports `findings/`.** The layer's
stage hands it `standingOf`, the corpora and the result text as inputs, so the two folders import
in one direction only (devil's review: revision 1 had `findings` → `arguments` and back).

```ts
export interface ArgumentRow {
  readonly kind: 'argument';
  readonly turn: number;                  // § 4.1 — the turn this row belongs to
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  readonly argument: string;              // top-level name, schema vocabulary like toolName
  readonly rule?: 'ask' | 'assume';       // absent = free (a row only because `from` named it)
  readonly period?: true;                 // the argument Tool.period names
  readonly source?: 'said' | 'answered' | 'result' | 'app' | 'default' | 'model'; // absent only on an asked row
  readonly asked?: 'missing' | 'unverified' | 'invalid-answer'; // 'invalid-answer': arguments note R4
  readonly value?: string;                // shownArgsOf(tool, args)[argument], clipped; 'REDACTED' when the view hides it
  readonly proposed?: string;             // answered row: the model's value it replaced, same view
  readonly claimed?: 'user' | 'result' | 'turn' | 'app' | 'assumed' | 'none'; // absent = sources unarmed
  readonly matched?: 'quote' | 'phrase' | 'spelling';                   // 'spelling': arguments note R5
  readonly quote?: string;                // as the model wrote it, clipped
  readonly reading?: true;
  readonly earlier?: true;                // the carrying message or answered row is from an earlier turn
  readonly result?: string;               // the result id claimed or found
  readonly setAside?: 'open' | 'noise' | 'ruled-out';
  readonly argumentsFrom?: 'listed' | 'unlisted'; // arguments note R6
  readonly appSource?: string;            // the ExternalGround or run-fact label that matched
  readonly free?: true;                   // answered through a free-text field: a name, not a choice
  readonly coincides?: 'person' | 'result' | 'app'; // the library's own lookup: a hint, never a source
  readonly malformed?: number;            // arguments note R6: dropped `from` entries when no basis row carries them
  readonly failed?:
    | 'quote-not-found' | 'composed-message'                        // 'composed-message': arguments note R3
    | 'unknown-result' | 'placed-result' | 'not-in-result'
    | 'no-earlier-turn' | 'not-in-earlier-turns' | 'only-in-model-answer'
    | 'not-in-app-text' | 'uncheckable';
}
```

- **Redaction goes through the tool's own argument view.** An agent's executor sets no state-level
  redaction policy (only `core/flowchartAsTool.ts` and `core/runbook/runbookAsTool.ts` set one, on
  their inner executors), and `core/Agent.ts` · `findings` hands out the committed ledger as a
  clone. So `value`, `proposed` and `quote` are built from `core/toolShownArgs.ts` · `shownArgsOf`,
  the checks run on the raw value in memory, and the raw value is never stored. The event never
  carries a value or a quote, and carries no length when the view hides the key (devil's review, a
  MUST-FIX).
- **Filed once per batch.** The layer returns all of a batch's rows through its output mapping in
  one merge (§ 4.1, § 5). Never one write per call.
- **Free-text answers.** A string field with no choices yields `answered` + `free: true`: the person
  gave a name. It is provenance, never support — the honest-answer page's rule that only `enum`,
  `number` and `boolean` fields carry the prompt-injection guarantee (§ 5.1 there).

**Provenance tiers** (honest-answer page § 5.1). `answered` → answered; `result` → observed; `app`
→ given; `default` → given, but never support, because an app default is a choice nobody in the
conversation made; `model` → judged. **`said`** is `claimed` text that a library check tied to a
value, placed in one ordered lattice — `claimed` ⊑ `said` ⊑ `answered` — rather than added as a
label beside `claimed` (research review).

**What the checks cannot see, and how the row says so.**

| Cannot be checked | Recorded as |
|---|---|
| what the person meant ("last week" → `7d`) with no phrase declared | a reading: the words and the value both kept |
| a negation or another sentence ("not the last 24h — the whole week", quoted as "the last 24h") | passes membership — undetectable, which is exactly why membership never supports "known" |
| a short or common value (`7`, `true`) | a hint only; the library's own bound for such matches is `integrity/argumentLeaves.ts` · `MIN_CHECKED_LENGTH` (4 characters) |
| a value or quote with no token after normalisation, or past the index ceiling | `failed: 'uncheckable'` — never a pass, never "not found" |
| messages the window evicted | not found; the check is window-relative, like the evidence index |
| a result that echoes the argument it was called with | passes; the evidence gate's documented bound. The earlier call has its own rows |
| whether the tool used the value | the tool's own `period.queried` (§ 3.3) |

#### (i) Against the host's own time-window flow

The host already solves part of this in app code (`host:be-server/queryWindowFlow.ts`, 143 lines):
a collecting tool that raises `requestInput` for missing year, timezone or bounds; a provider
wrapper that forces that tool's choice for absolute requests; a before-tool middleware that rewrites
`window` and `timezone` from the collected receipt; and an after-tool hook that attaches
`query_context.provenance`, whose origins are `declaration` (app default) or `response` (the
person).

- **Moves to the library:** relative look-backs (`-30m`, `24h`, `7d`) — ask or assume per argument;
  provenance per value on the ledger (the host's `declaration` / `response` map onto `default` /
  `answered`); the ask before the call without a forced tool choice.
- **Stays app code:** an absolute, compound window — a calendar date, a year, a timezone, two bounds
  and a DST-safe conversion (`host:be-server/timeContext.ts` · `finishQueryWindow`). A rule per
  argument cannot express a check across four values, so that stays `requestInput` inside a
  collecting tool.
- An answered value that passes the schema but that the tool then refuses is an ordinary tool
  error; the `answered` row stays.

#### What layer 2 lets you measure

From the record alone, per model and per prompt or skill version:
- the **assumed-value rate** — the share of calls that ran on a default nobody chose;
- the **ask rate** and the **needless-ask rate** (asked for something the person had said);
- the **declared-source rate** and the **verified rate** (a copying measure, § 1.1);
- the mix of failed claims (`quote-not-found`, `not-in-result`, `unknown-result`, …);
- the **reading rate** — values the model read into the person's words;
- **contingent uses** — values taken from a result the model had set aside.

### 3.3 Layer 3 · Read a result

Two halves: the **tool** declares what its result covered (the result doors), and the **model**
declares how it reads that result (the findings ledger).

**Exists.**
- *Declare:* `absent()`, `coverage()`, `lib/semantics/envelope.ts` · `semantic`;
  `Tool.resultColumns`, `resultCeiling`, `resultClass`; the model's `_findings.previous[]`
  standings.
- *Verify:* `stages/toolCalls.ts` · `declareCoverage`; `resultCeiling.ts` · `applyResultCeiling`;
  `integrity/column-types/check.ts` · `columnTypesOf`; `integrity/empty-lookup/check.ts` ·
  `emptyLookupOf`; `findings/offer.ts` · `knownResults`; `findings/contingent.ts`;
  `findings/unsettled.ts`; `findings/judge.ts` (advisory).
- *Record:* `coverageDeclared`, `claimFacts`; the ledger's standing, contingent, unsettled and
  judgment rows; events `tools.absent`, `tools.coverage_declared`, `result_refused`.
- *Serve:* the findings piece (`findings/serve.ts` · `findingsLedgerPiece`), the lens bands.

#### The three result doors (owner decision, 2026-09-26)

| Door | Use when | Wire (unchanged) |
|---|---|---|
| `absent()` | nothing matched | `af_absent` |
| `coverage()` | any other value that has limits | `af_coverage` |
| `describedResult()` | rows from a system of record | `af_semantics` |

- **`describedResult()` is the owner-decided name for `semantic()`.** Not `typedResult()`, which
  collides with `runTyped()`. The request is
  `agentfootprint-video-course:docs/library-requests/2026-09-26-typed-result.md`.
- **camelCase in the declaration, the unchanged snake_case on the wire.** `measuredAt`,
  `ageSeconds`, `sourceExportDate`, `isCounter`, `filterNote`, `chartHint` respell to
  `af_semantics`, `SEMANTICS_NOTE` and `canonical-notes.json` byte for byte. One spelling per door:
  `describedResult()` refuses the snake_case spelling; `semantic()` keeps its declaration
  byte-for-byte and is deprecated in TSDoc only.
- **Provenance is required at compile time** whenever facts or series are present (overloads or a
  conditional type, pinned by a `@ts-expect-error` test), so the author meets a missing source
  before the model does.
- **Already shipped in 9.118.1** (`f83f277c`): fix 0 (unknown or snake_case declaration keys are
  refused loudly by all three helpers, naming the camelCase spelling) and fix 1 (every helper refusal
  starts with the neutral `refused: ` prefix, so a failure no longer reads like a finding).
- **Open, from the request** (§ 10, Q11): a shorter model note when the result has no series; whether
  the model sees `describedResult()`'s `checked` list (`absent()`'s reaches it today); `absent()` has
  no place for a source or a time ("searched the export of 02:00 — nothing"); the `/observe` answer
  account's `readEmptiness` reads an envelope only as "returned a result".

#### The one period shape (owner item 7)

One shape, shared by the three doors and by the inputs layer's period argument:

```ts
// On absent() / coverage() / describedResult(): camelCase in, snake_case out
// (wire: `period: { queried: { from, to }, held: { from, to } | 'unknown', read_at? }`).
interface DeclaredPeriod {
  /** ISO 8601 instants WITH a zone, of the READ that produced these rows — not of "this call". */
  readonly queried: { readonly from: string; readonly to: string };
  /** What the store holds at the time of the read, or 'unknown', said out loud. */
  readonly held: { readonly from: string; readonly to: string } | 'unknown';
  /** When that read ran. A cached answer is served minutes after the read it describes. */
  readonly readAt?: string;
}

// On the tool (build time; also over MCP): which argument sets the period, in which spelling.
// Owned by arguments/ and shipped with step 3 (arguments note R8); coverage/period.ts owns
// DeclaredPeriod and the verdict rule (results.md § 3.4–3.5).
interface ToolPeriod {
  readonly argument: string;
  readonly spelling?: 'lookback' | 'signed-lookback' | 'iso-range';
}
```

- **Anchored on the read.** The host already anchors its `checked` items on the read, not the call
  (`host:py-tools/server.py` · `_influx_checked`), and returns `data_window.range_end` from the read's
  own rows. That is the field precedent for `queried` and `readAt`.
- **The library compares instants the tool declared; it never parses "2h".** The results layer files
  one verdict per call: `covered` · `partly-held` · `not-held` · `unknown` (the store said it does not
  know) · `undeclared` (the tool declared a period argument, and this result declared no period).
  Unknown coverage is said out loud.
- **`spelling`** lets the library carry ONE answered period to every period argument of the batch
  by a deterministic conversion between declared spellings (`24h` ↔ `-24h`), so a question that
  touches two tool families asks once. It is a conversion of declared formats, not phrase parsing.
- **Only an argument that bounds the period the answer covers may be declared a period.** A
  freshness horizon ("how far back to find the newest collection") is not one.
- **Why not `window`:** the word already names the context window (`src/core/agent/window/`,
  `.window()`). **Why not `CoverageItem.kind`:** a kind (`'existence' | 'scope'`, closed and
  record-only, `coverage/types.ts` · `CoverageItem`) cannot hold instants to compare.

#### New: the results layer

A subflow at the loop head (§ 5). It reads what ToolCalls committed — the batch's results,
`coverageDeclared`, the standings this batch's `_findings.previous[]` filed — and files, over its
steps:
- the period verdict rows (step 7);
- the reading checks (step 8): each `fact` standing checked against the result it cites (the step-5
  membership check, reused), filed as a row beside the standing and never a rewrite of it (the
  `unsettled` precedent); and `expectation-missed` (`BasisRow.expect: 'high'` against an absent or
  empty result);
- one outcome row per call (step 8): ran, errored, refused (ceiling, columns, middleware), placed,
  truncated, settled — so "refused" stops living only in events and text, and error text stops
  grounding identifiers.

**Gaps left.** A tool that declares nothing cannot be spoken for; the fold says so through
`empty-undeclared` and the printed `checked` list (§ 4.2), never by silence. `semantic({ clarify })`
stays data: a clarify never pauses the run.

#### What layer 3 lets you measure

The declaration rate per tool (the share of results that declare coverage and a period); the period
verdict mix; the empty-undeclared rate; the model's standing declaration rate and its agreement with
blind labels or the judge; unknown-id standings; contingent and unsettled rows; the
fact-not-in-result rate.

### 3.4 Layer 4 · Give the answer

**Exists.**
- *Declare:* posture, shapes, exempt; `.claims()`; `.outputSchema()`; `.answerValidation()`;
  `.limitsTravelWithTheAnswer()`; the answer's own `_findings`, peeled in the Route decider
  (`findings/peel.ts` · `peelAnswerFindings`, `stages/route.ts` · `peelAnswerStandings`).
- *Verify:* `stages/route.ts` (schema → steps → `judgeEvidence` → claims); `evidence/gate.ts` ·
  `checkAnswer`; `integrity/prior-turn-evidence/`; `answer-validation/validate.ts` ·
  `executeAnswerValidation`.
- *Record:* `unsupportedValues`, `outputAttempts`, `stoppedEarly`, `answerValidation`; the answer's
  `ContingentRow`s.
- *Resolve:* revise once (`stages/evidenceRecheck.ts`); refuse (rails, `.answerValidation()`, a
  message `deny`); flag.
- *After the run:* `lib/answer-account/account.ts` · `accountForAnswer` (reads events).

**New.**
- The standing fold (§ 4.2), first as a pure reader over recordings (step 1), then run by the
  answer layer (step 6).
- The answer layer: a subflow at the head of the final branch (§ 5). It folds and hands the result
  to PrepareFinal.
- Committed witness rows for the verdicts that are events only today — the gate's "grounded"
  (`agentfootprint.agent.evidence_checked`) and unfinished steps
  (`agentfootprint.skill.steps_unfinished`). They are filed by the Route decider, under the answer
  layer's arm, because that is where those verdicts are computed; the answer layer only reads them.
- The standing as data: a field on the run's result and one event (`agentfootprint.answer.assessed`,
  name open, carrying the value, the reason kinds and the checked list — no values). The prose line
  is opt-in, and it cannot be combined with `.answerValidation()`, which judges exact bytes
  (`AgentBuilder.answerValidation` already refuses the limits block for that reason).

**Gaps left.** "No errors" and small numbers are never checked by the gate; a question asked in
prose reads as an answer (the fold has no row for it; RQ3 labels it from the reply by hand).

**Resolve verbs here.** Label only. No ask at the answer: the call that could have used an answer
has already run, and the library never replaces the model's reply with a question.

#### What layer 4 lets you measure

**Answers that exceed their standing** — a flat non-existence or completeness claim on an answer
whose standing is not sure or ask (RQ3's `exceeds`); the standing mix per model; grounded values;
unsupported values; claim contradictions.

---

## 4. The one ledger and the standing fold

### 4.1 One ledger — decided, with its costs checked in code

**Decision (unchanged).** `AgentState.findingsLedger` is the one honesty ledger, not renamed. Every
new verdict is a new row *kind*, written by the one writer (`findings/ledger.ts` · `recordFindings`)
or its pure half (below). The docs call it "the honesty ledger".

**Why this key.** An empty write writes nothing (`recordFindings` returns on an empty list). The
resume door already carries it (`core/runCheckpoint.ts`), and refuses malformed rows
(`runCheckpoint.ts` · `ledgerRowIsWellFormed`). Readers select by kind (`findings/ledger.ts` ·
`foldLedger`; the lens's findings band and proof map skip other kinds). The model is served it only
under `.findings()` (`stages/callLLM.ts`, `deps.hasFindingsLedger`). One writer means one event law
and one redaction surface.

**Costs — each verified on 2026-09-26 — and the answer to each.**

| Cost | Answer |
|---|---|
| **The ledger carries into the next turn.** `core/Agent.ts` · `checkpoint` puts it on the conversation checkpoint; the continue path stashes it; `stages/seed.ts` restores it. Rows carry `iteration`, which restarts at 1 every run, so a turn-1 `default` row would make a turn-2 answer that never called the tool read "not sure". Revision 1 did not see this, and the arguments note said the opposite (engineer review, a MUST-FIX). | While any layer is armed, the one writer stamps **`turn`** on every row it files: `AgentState.turnNumber`, which seed derives from the conversation (`stages/seed.ts` · `countUserTurns`; a floor that may skip a number and never collides). The fold reads only this turn's rows. An earlier turn's `answered` row stays readable by the inputs layer as the person's earlier answer, marked `earlier`. The checkpoint door accepts the field on every kind. Unarmed, no row changes. |
| **The restore is wired only under `.findings()`** (`core/Agent.ts`, the `this.findingsOptions !== undefined` spread), so rows written on an agent without `.findings()` would be dropped on a continued conversation. | Wire the restore whenever any layer is armed, still value-conditional (only when the checkpoint carries rows). |
| The checkpoint door refuses unknown kinds (the judge rows were refused until 9.110.0), and an older runtime refuses a newer checkpoint that carries a new kind. | Every step adds its door arm in the same change and names the older-runtime refusal in its changelog fragment. |
| **Each write copies and re-folds the whole ledger, and commits the whole array.** `recordFindings` builds `[...prev, ...rows]`, re-runs `foldLedger`, and assigns the root key; footprintjs's output mapping also re-sets a whole top-level array (`fp:src/lib/engine/handlers/SubflowInputMapper.ts` · `applyOutputMapping`). This is the first program that files rows without the model's help, one per ruled argument per call. | A layer writes **once per run of its subflow** — one merge per batch, never per call. Step 3 measures commit-log bytes over a 50-iteration run and the merge at 1,000 rows. An append-only merge through footprintjs's `append` verb is a separate, measured footprintjs change, taken only if those numbers ask for it. |
| `FindingsRow` gains members, which breaks consumers that switch over every kind; `agent.findings()` starts returning rows on agents without `.findings()`. | Both named in the changelog; readers must skip unknown kinds (the lens already does). |
| The name says "findings". | Keep it. A rename breaks recordings, the lens, the checkpoint door and the byte references. |

**How a layer writes.** `recordFindings` splits into its two halves, with one owner each:
- `appendRows(prev, rows)` — the pure fold: merge, plus any new conflict rows;
- the emit half — one event per row (`findings/ledger.ts` · `emitRow`).

`recordFindings(scope, rows)` stays both, for the in-stage callers that exist (ToolCalls, Route). A
layer's Record stage emits its rows' events inside the subflow and stages the rows on its own
scope; the mount's output mapping then calls `appendRows(parent.findingsLedger, sf.rows)` with
`arrayMerge: Replace` — the loop-crossed mount law of agentfootprint's CLAUDE.md. Layer verdict rows
never enter `conflictsOf` (only `fact` standings do, `findings/ledger.ts` · `foldLedger`), so the
merge adds no conflict. One writer, one fold, one committed copy per layer run.

**What stays out of the ledger.** Tool and app declarations keep their own keys:
`coverageDeclared`, `toolChoices`, `claimFacts`, `middlewareDecisions`, `unsupportedValues`,
`answerValidation`, `stoppedEarly`, `outputAttempts`. Each has one writer, its own readers and
pinned bytes. New rows reference them by `toolCallId` and never copy them. Where a verdict exists
only as an event today — the gate's "grounded" (`agentfootprint.agent.evidence_checked`),
`integrity.context_error`, the disposition event at the end of the run — the step that needs it adds
one committed row. **The fold never reads events**, so the running agent and a later reader always
fold the same bytes.

### 4.2 The standing fold — four values, no "known" from silence

`assessment/assess.ts` · `assessAnswer(record)` is pure. It reads committed rows only — the ledger
plus the keys above — for this turn, and returns:

```ts
interface AnswerAssessment {
  readonly assessment: 'known' | 'unrefuted' | 'unknown' | 'not-applicable';
  readonly reasons: readonly { reason: Reason; layer: 1 | 2 | 3 | 4; witness: readonly RowRef[] }[];
  readonly support?:
    | { kind: 'claims'; checkedPass: readonly string[] }
    | { kind: 'answer-validation'; reportDigest: string };
  /** What actually ran this turn, printed verbatim — never a fixed list. */
  readonly checked: readonly { layer: 1 | 2 | 3 | 4; check: string; ran: number; of: number }[];
}
```

**The value set is the honest-answer page's, not a new one**
([2026-09-honest-answer-ledger.md](../2026-09-honest-answer-ledger.md) § 5.6; § 15, R3-11). Revision 1 invented a three-valued fold that read "known" off silence and had no
value for "nothing was checked"; both are gone (research review, a MUST-FIX).

| Value | When (this turn's committed rows) |
|---|---|
| `known` | a **supporting** row exists for these bytes — every declared `.claims()` field `checked-pass`, or a passed enforce `AnswerValidationReport` — and no reason fired |
| `unrefuted` | at least one check ran, none fired, nothing supports. A check ran when this turn's record holds its verdict: a recognized coverage declaration, a readable result shape (the emptiness reading below), an argument or period verdict, the gate's witness, a claim disposition |
| `unknown` | at least one reason fired |
| `not-applicable` | no check ran on this answer — for example, a turn whose tools declared nothing and returned nothing readable |

**The owner's words are a rendering on top**, from versioned templates:

| Value | Reason class | The person reads |
|---|---|---|
| `unknown` | an **ask-class** reason: the turn ended in a typed ask (the library's argument ask, or a tool's own `requestInput`), or a ruled argument was asked and never answered | *Ask — Which period should the error search cover? (1h · 24h · 7d)* |
| `unknown` | any other reason | *Not sure — window = "2h" was assumed (the tool's rule); you did not give it.* |
| `known` | — | *Known — the answer's claims were checked against the run's settled facts: …* |
| `unrefuted` | — | *Consistent with the run's record — 3 checks ran, none fired: argument sources · tool coverage · names and numbers.* (never "known", never "verified") |
| `not-applicable` | — | *Not assessed — no check applied to this answer.* |

Precedence: **ask > not sure > known > consistent > not assessed.** `known` and `unrefuted` exclude
each other; support decides.

**Seven rules the fold keeps.**
1. **No "known" from silence.** "Nothing fired" is `unrefuted`. On the host, a gate-grounded answer
   with every content check not applicable was a false-known ("No VMs are currently hosted on …");
   under this fold it reads "consistent with the record", and the checked list shows how little ran.
2. **No membership pass supports.** Argument sources, result membership, grounded values: each can
   make a reason fire; none can support. Only tie checks support (§ 1.1).
3. **An unarmed check is not a reason.** It is simply absent from `checked`, which is printed as it
   is — so a reader sees what ran and what did not. An ARMED check that could not run is a reason
   (`check-unreachable`, the disposition `unreachable`, `integrity/disposition/types.ts` ·
   `Disposition`). Revision 1's strict bar (an applicable check that did not run makes the answer
   not sure) would have made every typical agent read "not sure" forever, and people would learn to
   ignore it (devil's review).
4. **Declared silence is a reason.** A tool that declares a period argument but returns no period →
   `period-undeclared`. A result whose top-level rowset is empty and that carried no `absent()` or
   `coverage()` → `empty-undeclared`. This closes revision 1's hole where a bare `[]` behind "No
   errors were logged" folded to known (devil's review, a MUST-FIX).
5. **This turn only** (the `turn` stamp, § 4.1). For a recording made before the stamp existed, the
   carried rows are the ledger as seed's restore left it; the rows beyond that prefix are this run's.
   The commit log says which commit wrote what.
6. **"Rests on" in v1** = every call of this turn that reached its layer's check. It may
   over-report; it never hides. Layer 3's outcome row narrows it later.
7. **The model's own answer-level standing** (the answer's `_findings`) never raises or lowers the
   value; the lens shows it beside the chip (honest-answer page § 15, R3-15).

**The reasons** — a closed union; each names the row it is read from.

| Layer | Reason | Read from | Step |
|---|---|---|---|
| 2 | `argument-assumed` | `argument` · `default`; or a middleware rewrite of a ruled argument with no declared origin | 3 |
| 2 | `argument-unverified` | `argument` · `model` on a ruled or period argument (undeclared, assumed, a failed claim); and a failed claim on ANY argument, because the model then misstated the record | 3, 5 |
| 2 | `argument-read` | `argument` · `said` + `reading` (on an `ask` argument it asked instead) | 5 |
| 2 | `value-contingent` | `argument` · `result` + `setAside`; `ContingentRow` | 5 |
| 2 | **ask** · `argument-asked` | the library's argument ask pending at the end of the turn; an asked row never answered | 4 |
| all | **ask** · `asked` | a tool's own `requestInput` pending at the end of the turn — read from the paused run's checkpoint (its pause data carries `awaitingInput`), never from an event | 1 |
| 3 | `declared-absent` | a `coverageDeclared` absence on a call this turn, or a `coverage()` whose wrapped rowset is empty (the one emptiness reader, `coverage/emptiness.ts` · `readEmptiness`, [results.md](results.md) § 5.2) | 1 |
| 3 | `coverage-gap` | a `notChecked` or `cannotCover` item on a call this turn | 1 |
| 3 | `empty-undeclared` | the one emptiness reader over every result: an empty rowset (a top-level array, or a key the app declared in `rowsAt`) with no coverage row for that call fires it; a non-empty rowset passes; any other shape is not applicable | 1 |
| 3 | `coverage-undeclared` (proposed, [results.md](results.md) Q5; adopted 2026-09-27) | a result from a tool that declares `resultClass: 'triage'` or `'inventory'` and filed no coverage row | 8 |
| 3 | `period-partly-held`, `period-not-held`, `period-unknown`, `period-undeclared` | the period verdict row | 7 |
| 3 | `tool-refused`, `result-truncated` | the outcome row | 8 |
| 3 | `fact-not-in-result`, `expectation-missed` | the reading-check row | 8 |
| 3 | `sources-conflict` | `ConflictRow` | 1 |
| 4 | `value-unsupported`, `value-survived-revision` | `unsupportedValues`; the gate's committed witness row | 1, 6 |
| 4 | `claim-contradicted` | a `.claims()` `checked-fail` | 1 |
| 4 | `stopped-early` | `stoppedEarly` | 1 |
| 1 | `source-not-consulted` | a typed `tryInsteadTool` never called; a declared ontology holder never called | 9 |
| all | `check-unreachable` | a disposition `unreachable` on an armed check | 1 |

The honest-answer page's placement reasons (`subject-unresolved`, `argument-kind-mismatch`, …) stay
on hold with its step 3.

### 4.3 The paper's RQ3 is this fold, restricted to layer 3

The study's registered algorithm (`study:study/design-v2.md`, "RQ3") reads a standing per turn from
recorded events. The library port is this fold over layer-3 rows:

| RQ3 standing | This fold |
|---|---|
| ASKED — the turn ended in a recorded typed ask | `unknown`, ask class |
| NOT-COVERED — a result declared a coverage gap for the entity the question names | `unknown` · `coverage-gap` |
| DECLARED-ABSENT — the last lookup for that entity returned `af_absent` | `unknown` · `declared-absent` |
| FOUND — a lookup for that entity returned rows | `unrefuted` (never `known`: no tie check) |
| UNKNOWN — nothing declared; most PLAIN turns | "the record cannot vouch": `unknown` · `empty-undeclared` when the empty result is a readable rowset, `not-applicable` when nothing readable came back |

One difference, named: RQ3 scopes to "the entity the question names", which the study's cases know;
the library has no subject placement (on hold), so its fold takes every call of the turn and may
over-report. Step 1's parity test runs both over the study's recorded runs and explains every
disagreement. The study keeps its hash-frozen copy (`study/rq3-standing/`, "the library port comes
later"); the port must not change a frozen verdict.

**Where the fold runs.** After the run, as a pure reader: `agent.assessment()` (name open), the lens
chip, and `lib/answer-account/facts/howSure.ts`, which then reads the one owner instead of saying
"NOT BUILT". At run time, only in the armed answer layer, for the served forms. A test pins that the
in-run fold equals the fold of the same recording read afterwards.

---

## 5. The subflow layout

### 5.1 The picture

```
Initialize → [memory reads]
  → ⟨Results layer⟩ᴬ ─────────────── loop head when armed: every tool-calls loop enters it first
  → [Compact] → InjectionEngine → Context ⇉ {System Prompt ‖ Messages ‖ Tools} → … → CallLLM → [NormalizeThinking]
  → ⟨Choice layer⟩ᴬ → ⟨Inputs layer⟩ᴬ ── per batch; acts only when Route's own predicate says the batch dispatches
  → Route ─┬─ tool-calls: ToolCalls (applies the inputs layer's fills) ──loopTo──▶ loop head
           ├─ output-retry · step-nudge · evidence-recheck · wrap-up (conditional mounts, unchanged)
           └─ final: Final subflow = ⟨Answer layer⟩ᴬ → PrepareFinal → [memory writes] → BreakFinal

ᴬ mounted only when armed — the unarmed chart is byte-identical.
Inside every layer: Declare → Verify → Record → Resolve (four small stages).
```

"Mounted only when armed" is the WrapUp precedent: `buildAgentChart.ts` adds the WrapUp branch only
when `deps.wrapUpStage` is set, so an agent that never asked for it has the chart it always had.
In the dynamic chart (`core/agent/buildDynamicAgentChart.ts`) CallLLM sits inside `sf-llm-call`;
the layers mount outside it, at the same places. Both chart builders call **one mount helper**
(`core/agent/honesty/mounts.ts`, name open), so the twin builders cannot drift.

### 5.2 Why each layer sits where it does (checked in code)

- **Inputs layer — after the LLM call, before Route.** A decider branch can loop only to a stage
  declared before the decider, and it has no other continuation
  (`fp:src/lib/builder/FlowChartBuilder.ts` · `DeciderList._applyBranchLoop`). So "between CallLLM
  and ToolCalls" can only mean after the LLM and before Route. The layer asks only when
  `stages/route.ts` · `decideBranch` would pick `tool-calls` (§ 3.2 (d)); on a reply with no tool
  call its first stage returns at once.
- **Results layer — at the loop head, before `Compact`.** This is the owner's "after ToolCalls":
  ToolCalls' `loopTo` lands on it, so it runs right after every batch and before the next LLM call.
  This is the `Compact` precedent in
  `core/agent/buildAgentChart.ts`: a stage "mounted immediately before the current loop target, and
  it BECOMES the loop target". Before `Compact`, so it reads the batch's results before any window
  strategy folds them away. On the first iteration there is nothing to read and it returns.
- **Answer layer — the first node of the final branch, ahead of PrepareFinal.** A decider branch is
  one node with no continuation, so the literal "between Route 'final' and Final" cannot be drawn as
  a separate node. Inside the final branch it runs after Route has chosen `final`, and so after the
  evidence gate, the claims seam and the answer peel have written their verdicts. Final's output
  mapping returns only `finalContent` (and the validation flag) today — the `SUBFLOW_IDS.FINAL`
  mount in `buildAgentChart.ts` — which is why the 9.114.x answer peel had to live in the Route
  decider. The armed build adds the layer's rows to that mapping, through `appendRows`; unarmed, the
  mapping is byte-identical (open question Q3).
- **Choice layer (last in the plan)** — the same point as the inputs layer, just before it.

### 5.3 Isolation, write-back and pause (footprintjs facts)

- **A subflow runs in isolated state.** Keys passed in by the input mapping are frozen inside it
  (the `prior*` aliases in `buildDynamicAgentChart.ts`'s header exist for this reason). So each layer
  receives only what it reads — the batch, the rules, a projection of the standings for the results
  it names (including this batch's own `previous[]` standings, in memory — arguments note R10) —
  never the whole ledger.
- **The output mapping merges back.** Top-level arrays concatenate unless `arrayMerge: Replace`, and
  a plain object merges field by field (`fp:` `applyOutputMapping`). So a layer returns:
  - its new rows, merged into the ledger by `appendRows` (Replace);
  - for the inputs layer, the fills, as an ARRAY with Replace — never an object, which would merge
    into the previous iteration's. One entry per call, `argumentResolutions`:
    `{ toolCallId, fills?: { argument, value, source }[], refused?: string }`, because a refused
    call needs the same carrier (arguments note R7, adopted 2026-09-27; revision 1 of this note had one
    entry per filled argument).
- **Pause inside a layer.** While the inputs layer's ask is pending, its rows live in the paused
  subflow's state, carried by the checkpoint (`checkpoint.subflowStates`); the events already
  fired in the Record stage; the rows reach the ledger when the layer completes on resume. The
  pending ask is on the record twice: as the pause event (`agentfootprint.pause.request`, whose
  payload is the whole pause data) and in the paused run's checkpoint, whose pause data carries
  `awaitingInput` with the library's marker. The fold reads the checkpoint, never the event. A host
  cancel (`hosting/standingAgent.ts`: `input_cancelled`, a fixed reply) runs no
  chart, so nothing reaches the ledger and nothing is served; only a later reader of the stored
  conversation can fold it as "ask".
- **Lazy load.** Each layer's module loads through `import()` when armed — the optional-family law
  `findings/peel.ts` states — so a plain agent's bundle and the docs site budget do not grow.

### 5.4 Costs, named

- Every armed iteration runs one or two more subflow mounts (stages and commit bundles). Step 3
  measures the per-iteration overhead and the commit bytes; no number is claimed before that bench.
- The ask happens before permission and middleware (§ 3.2 (e), Q4).
- The old pieces stay where they are: the findings peel and `declareCoverage` in ToolCalls; the
  evidence gate and the answer peel in the Route decider. **Nothing moves.** A piece moves into a
  layer only if a bench and a performance measurement both say so. `stages/toolCalls.ts` is about
  6,000 lines with several tool_end paths and resume doors; `test/architecture/citations.test.ts`
  pins every `file · symbol` pointer; recordings, the lens and the checkpoint read keys, not folders.

### 5.5 The folders

```
src/core/agent/
  honesty/      NEW  README (the contract, the index, the fold's table) · armed.ts (which layers are
                     armed — the one run constant, seeded the `findingsServe` way) · mounts.ts (the
                     conditional mounts both chart builders call)
  toolChoice/   exists  layer 1; gains subflow.ts in step 9
  arguments/    NEW  layer 2, Mixed: declare.ts · rows.ts (Map) · resolve.ts · sources.ts (Walker)
                     · ask.ts · serve.ts (Lens) · subflow.ts · README.md. A leaf: never imports findings/.
  coverage/     exists  layer 3's result doors; gains emptiness.ts (step 1, the one emptiness reader)
                     and period.ts (step 7b)
  results/      NEW  layer 3's subflow + README; its rules stay with their data (coverage/, findings/)
  findings/     exists  layer 3's model reading AND the one writer of the ledger (ledger.ts)
  evidence/     exists  layer 4's names-and-numbers check; exposes the one per-result reading
  assessment/   NEW  layer 4, Mixed: assess.ts (Fold) · reasons.ts · compose.ts (Lens) · subflow.ts · README.md
  stages/       exists  the seams: ToolCalls applies fills; Route exports decideBranch

docs/design/honesty/
  README.md     the contract, the layer index, the standing table, the plan's status
  decisions.md  the owner's framing and the answers adopted on 2026-09-27
  choice.md     layer 1          inputs.md   layer 2
  results.md    layer 3          answer.md   layer 4
```

(Revision 2 drafted the layer pages as `1-choice.md` … `4-answer.md`; step 0 named them by layer
instead, so a link says which layer it means.)

Each layer folder's README, in order: one role word on the first line
(`test/architecture/folderRoles.test.ts`); the layer's law in one sentence; the seven-clause table
with pointers `citations.test.ts` checks; one runnable example from `examples/features/`; a
"Not covered" section; and "What it lets you measure". Existing folders gain a short "Honesty
layer" section with the law and a link.

The one-sentence laws:
- *Choice:* The record says what was offered, what was left out and why, and which declared holder
  was never consulted; the choice stays the model's.
- *Inputs:* No argument runs unaccounted for.
- *Results:* A result says what it covered, its period included; silence about a declared period is
  recorded as silence.
- *Answer:* The standing is folded from the rows, never from the model's confidence, and "known"
  needs a row that supports it.

---

## 6. Benchmarks first — and what each layer lets you measure

### 6.1 The protocol, the same for every layer

A layer earns its place before its code becomes a default:

1. **Provoking cases** for its decision point, and **controls** where the layer should do nothing.
2. **A baseline measured without the layer**, on the same cases.
3. **A success rule registered before the first paid call**, including a non-inferiority margin on
   needless asks and on correct answers.
4. **Before and after on the same day, interleaved, on a freshly loaded seed, with verdicts from
   blind hand labels only.** The one before/after the host ran showed day-to-day variance larger
   than the effect it was sized to see ([decisions memo](../2026-09-honest-answer-ledger-decisions.md)
   § 8.3); these are now the host bench's own
   rules.
5. **Haiku 4.5 only**, inside a budget the owner approves per run. Every dollar figure is an
   estimate until the run's own record says otherwise.
6. **Kept only if it shows a gain.** A null is recorded as a null, and the arm stays opt-in or is
   withdrawn.

**Measured nulls to respect.**
- The served findings piece showed no benefit at ten runs, and it cost fact fidelity:
  facts-in-answer fell from 1.000 to 0.917 under the ledger on both models
  ([2026-09-findings-ledger-worklog.md](../2026-09-findings-ledger-worklog.md), the signal-cell
  entry of 2026-09-17).
- Haiku declared about half the time in the recorded bench tables
  ([2026-09-findings-ledger-real-model.md](../2026-09-findings-ledger-real-model.md)).

Every layer that asks the model for a declaration (layer 2's sources, layer 1's basis) must
therefore be measured for what the declaration costs as well as what it catches.

### 6.2 Per layer

| Layer | Provoking cases | Baseline | What it lets you measure — from the record alone |
|---|---|---|---|
| 1 · choice | wrong-kind entities; a skill picked for the wrong estate (the honest-answer page's field case F3) | the unarmed agent | basis declaration rate; exploratory share; chosen-is-declared-holder rate; `source-not-consulted` rate; offered versus chosen |
| 2 · inputs | questions with no stated period; names the person never said; a period said in words ("last week"); controls where the person gave the value exactly | the tool's silent default | assumed-value rate; ask rate; needless-ask rate; declared-source rate; verified rate; failed-claim mix; reading rate; contingent uses; tokens per call |
| 3 · results | a store whose held period starts after the queried one; empty results with and without a declaration; a `fact` standing whose cited result lacks the value | the unarmed agent; for declarations, the study's PLAIN transform | declaration rate per tool; period verdict mix; empty-undeclared rate; standing declaration rate and its agreement with blind labels; unknown-id standings; fact-not-in-result rate |
| 4 · answer | the paper study's absent and wrong-kind cases (its C, D and F kinds: false non-existence, overclaim) | the model's verbalised confidence; its own `_findings` answer standing | answers exceeding their standing; standing mix; grounded values; unsupported values; claim contradictions |

**The honesty profile.** Read together, these metrics are a per-model profile — comparable across
models and across prompt or skill versions — built from the same rows the bench, the paper and the
lens read. **The limit:** it measures honesty (claims within evidence), not truth. A false answer
built from real values passes the evidence gate by that gate's own design (agentfootprint
CLAUDE.md, the evidence gate row: "Fabrication detector, NOT a correctness judge").

### 6.3 How the paper uses it

- **Scope.** The method is general; the evidence is for layer 3. The registered study measures tool
  coverage declarations, and it states: "It is not claimed that the runtime puts the declarations
  into the reply" (`study:study/design-v1.md`, "The claim"). Layers 1, 2 and 4 go under Future Plans,
  each as a falsifiable claim with planted defects. For layer 2: *questions that leave out the period
  on a tool that defaults to 2h; arming layer 2 moves those answers from consistent to not sure or
  ask, without raising needless asks on the controls* — the study's non-inferiority test on needless
  ASK already has this shape.
- **No served honesty arm is on in any study arm**, and the study pins its library version at the
  freeze (the host pins agentfootprint 9.116.0 today). A served standing line in one arm would change
  the treatment and could break the raters' blinding.
- **The standing is evaluated like abstention.** The error rate among answers the fold calls
  "consistent" or "known" against those it calls "not sure"; a risk–coverage curve against blind
  adjudicated labels; two baselines — the model's verbalised confidence and its own `_findings`
  answer standing. RQ3's rule is the first instance: sensitivity ≥ 0.8 and specificity ≥ 0.9 in
  DECLARED; in PLAIN, at least 80% of turns fold to "the record cannot vouch" (not assessed, or not sure because nothing was declared).
- **Method section.** The seven clauses are the method; Resolve and Arm are the Walker's properties;
  layer 3 is the preliminary result; layers 2, 4 and 1 are the concrete plan (the venue requires a
  "Future Plans" section).

**Related work to position against** — each citation is to be checked against its source before
the paper uses it:

| Line of work | Representative source | What this design adds |
|---|---|---|
| data provenance (why- and where-provenance) | "Why and Where: A Characterization of Data Provenance" (ICDT 2001); the W3C PROV-DM model (2013) | layer 2's source checks are where-provenance checks in which the model declares the edge and the library checks it |
| completeness of incomplete databases; local closed-world reasoning | "Integrity = Validity + Completeness" (ACM TODS 1989); "Obtaining Complete Answers from Incomplete Databases" (VLDB 1996); "Completeness of Queries over Incomplete Databases" (VLDB 2011); local closed-world reasoning for planning agents | `absent()`, `coverage()` and the period's queried/held are completeness statements served to an agent and read back into a standing |
| frame-based slot filling and dialogue state tracking | the GUS frame-driven dialog system (1977); the MultiWOZ benchmark (2018) | ask-or-assume per argument is required and default slot elicitation, plus recorded provenance and a standing |
| MCP elicitation | the MCP specification revision of 2025-06-18 | the same flat primitive form as `core/inputRequest.ts` · `InputField`, raised by the client's loop from a declaration |
| verbatim-quote support | "Teaching language models to support answers with verified quotes" (2022); provider citation features | quotes back the tool's arguments, not the answer |
| selective prediction; self-reported reflection | selective classification and risk–coverage (JMLR 2010; NeurIPS 2017); reflection tokens in Self-RAG (ICLR 2024) | the evaluation frame, and the self-report comparator |

---

## 7. Evolution — small steps, each shippable alone, byte-identical when off

**Every step's checklist.**
- **Tests of all seven types** — unit, functional, integration, property, security, performance,
  load. A type that does not apply is named as such.
- **Gates.** The 21 byte references in `test/core/tools/reference/` unchanged when nothing is
  declared, plus one new reference for the armed case; every new sentence registered in
  `test/modelFacingSurfaces.test.ts`; `folderRoles` and `citations` passing; a
  `ledgerRowIsWellFormed` arm for any new row kind; the docs site budget measured after the last code
  change (a new export adds API reference routes).
- **Docs.** The layer page under `docs/design/honesty/`, the folder README, a CAPABILITIES row, a
  `.changes` fragment, the docs-next page, `examples/features/NN-….ts`, then `npm run docs:regen`.
- **Delivery.** A step is delivered only when the host re-pins and the behaviour is counted by hand.

| # | Step | Ships | Arm (off ⇒ byte-identical) | Needs |
|---|---|---|---|---|
| 0 | **Docs skeleton** | `docs/design/honesty/` (the index + four layer pages seeded from § 3); a pointer in agentfootprint's CLAUDE.md capability section | — (no code) | — |
| 1 | **The standing, as a pure reader ($0)** | `assessment/assess.ts` · `assessAnswer` over recordings, from EXISTING rows only (coverage, ledger, `unsupportedValues`, claims, dispositions): the four values, the rendering, the reasons marked "1" in § 4.2; the one emptiness reader `coverage/emptiness.ts` · `readEmptiness`, shared with the `/observe` answer account and its described template ([results.md](results.md) § 5.2); `howSure.ts` reads it; the lens chip. **First**, before anything else in the step: the confusion table of the fold against the oracle over the retained recorded runs ([decisions memo](../2026-09-honest-answer-ledger-decisions.md) § 2.2), and the parity test with the study's frozen RQ3 on its records | none — nothing runs inside a run | — |
| 2 | **Inputs bench and baseline** | provoking cases and controls, the unarmed baseline, the registered rule (§ 6) | bench only; owner budget | — |
| 3 | **Inputs layer: assume** | `arguments/` (declare, resolve, rows, serve); `askOrAssume` with `assume` only — an `ask` rule is refused at definition until step 4, so no declaration promises what the library cannot yet do; `Tool.period` (`ToolPeriod`, owned by `arguments/`, arguments note R8); MCP carriage of both in `McpToolExtras`; the schema decoration at the one site (`core/slots/buildToolsSlot.ts` · `commitWire`, and `stages/seed.ts`'s `dynamicToolSchemas` twin) — `mergeWire` must also return the winning TOOL per served name (it returns only `winners`, name → party, today), and a name with no known tool is not decorated (the dispatch re-read is the guard); the inputs subflow and its mount; `appendRows`; the fills in ToolCalls; the `argument` row kind, its checkpoint arm, the widened restore and the `turn` stamp; the result note and the tool-bytes boundary the evidence index reads through (§ 3.2 (c)); the declared defaults in the gate's exempt corpus; the argument event (names and enums only); the "Assumed" line under an existing `.limitsTravelWithTheAnswer()`; the two doc-comment updates (`core/checkin.ts` · `CheckInRequest.args` now carries filled values; `agent.findings()` returns rows without `.findings()`) | a tool declares `askOrAssume` (and `.inputsLayer()` for ruled tools only a ToolProvider serves — arguments note R11, adopted 2026-09-27) | 2 |
| 4 | **Inputs layer: ask for missing values** | the batch ask, the pause and resume inside the layer, `answered` rows, the stamp change for a batch origin, the `argumentAskContext` hook (or the statement), `build/input-requests.mdx`; the needless-ask measurement on the step-2 cases; answered values join the gate's exempt corpus (arguments note R9) | an `ask` rule | 3 |
| 5 | **Inputs layer: declared sources** | `_findings.from` on ruled tools only; the checks; choice phrases (`said`); unverified → ask under the arm; the source checks reading through step 3's tool-bytes boundary; the one per-result reading exposed from `evidence/`; adversarial tests (a quote found only in a library frame or note; the value in a different result than the one named; a set-aside result; an evicted turn; a negation; Unicode normalisation; a number and a boolean in compact JSON) | `.findings({ argumentSources: true })` | 4 |
| 6 | **Answer layer (run time)** | the subflow at the head of the final branch; Final's mapping carrying its rows; the committed witness rows for the gate's "grounded" and unfinished steps, filed in Route under the arm; the run constant naming the armed layers; the result field and `agentfootprint.answer.assessed`; the prose line under its own arm (refused with `.answerValidation()`); the equality test (in-run fold = read-after fold) | its own builder option | 1, and any row-producing step |
| 7 | **Results layer: `describedResult()` and the period** | 7a (independent, may ship any time): `describedResult()` — camelCase in, the unchanged wire out, provenance a compile error, the `checkSemantics` advice naming it, `semantic()` deprecated in TSDoc. 7a′ (after 7a): the empty-data refusal names `absent()`. 7b: `period` on the three doors and `provenance` on `absent()` (one rule set in `coverage/period.ts`, refused if malformed when the envelope is built, read without repair), the coverage channel carrying `period`, the `canonical-notes.json` wire contract (so the host's Python helpers can mint it), the results subflow, the period verdict rows and reasons, the `Period:` line under an existing `.limitsTravelWithTheAnswer()`, the lens reading `period`. 7c (owner's call): the composed note. Detail: [results.md](results.md) § 7 | 7a: the new door; 7b: a result declares `period`, or its tool a `ToolPeriod` | 7b: 1, 3 |
| 8 | **Results layer: reading checks and outcome rows** | fact-in-result (reusing step 5's check), `expectation-missed`, one outcome row per call at one landing funnel (the door, its counts, the emptiness reading, refused / errored / truncated / placed); `coverage-undeclared` ([results.md](results.md) Q5, adopted 2026-09-27) | the results layer | 5, 7b |
| 9 | **Choice layer** | recorded omissions (attention visible, role-hidden unnamed); `source-not-consulted` | its own builder option | 1 |

**Why this order.** Step 1 needs nothing and gives the paper its library port. Step 3 needs step 2's
baseline, or nothing can show a gain. Step 4 needs step 3's layer. The unverified → ask rule waits
for step 5, the first point at which a value can be verified at all. Step 6 needs a reader (step 1)
and rows to fold. Step 7a waits for nothing — the owner has decided the name. Step 7b needs step 3,
because the `ToolPeriod` it reads ships there and is refused without an argument rule. Step 9 is last,
because its checks read declarations few tools make yet (a typed `tryInsteadTool`, ontology source
aliases), and its provoking cases (wrong-kind entities) overlap the honest-answer page's step 3,
which is on hold.

---

## 8. What this design deliberately does NOT do

- **No module moves**, no rename of `findingsLedger`, no second ledger, no migration of existing keys
  into it.
- **No model confidence anywhere in the standing.** The judge stays a second reading; `basis`,
  `expect` and standings stay claims.
- **No new footprintjs node type, no new loop moment**, and no key an unarmed run can see.
- **No interpretation of the person's words** — no time-phrase parsing. Only phrases an author
  declared on a choice are matched, as tokens; anything else the model read into the words is filed
  as a reading.
- **No subject placement.** `resolves`, `argumentKinds` and `placements` stay the honest-answer
  page's step 3, on hold (decisions memo § 8.4).
- **No new blocking verb at the answer.** The standing labels; refusing stays with rails and
  `.answerValidation()`.
- **No change to the evidence gate's grounding law.** A default the tool's own result echoes still
  grounds; a declared default joins the exempt corpus as the app's declaration; the library's note
  grounds nothing. The fold says who chose the value.
- **No mandatory `_findings`.** An undeclared source is a recorded verdict, not an error.
- **No ask at the answer and no ask after a tool.** `ToolResultOutcome` stays `allow | deny`.
- **No prose added to the answer by default.** The standing and the assumptions travel as data and
  events; prose is opt-in (the owner's 2026-09-18 ruling for the host).
- **No rules outside the library's own dispatch loop in v1**, except MCP carriage, which ships with
  the first layer. Inner dispatch (`core/agent/toolDispatch.ts` · `agentToolDispatch`) refuses a
  ruled tool unless every ruled argument is given (the `checkIn` / `wants` precedent).
- **No served honesty arm in any study arm.**

---

## 9. Considered and rejected

| Proposal | Where from | Why not |
|---|---|---|
| Stamp `answeredByPerson` on tool messages so a later call or turn can trace an answered value | the arguments note; engineer review (as a byte-change risk) | The `answered` row, stamped with its `turn`, already rides the conversation checkpoint with the ledger (§ 4.1). Reading it there changes no history bytes for any existing `requestInput` run, needs no new framework field in `composeRequest.ts` · `stripFrameworkFields`, and survives compaction, which a marker on a history message does not (devil's review). Cost: the widened restore. |
| Make the layer's result note carry the argument's name without its value, so no value can launder | engineer review, second option | The model needs the value to know what ran ("no errors in 2h"). The haystack stops at the tool's own bytes instead (§ 3.2 (c)). |
| Define "known" over the checks the agent armed | devil's review | Accepted in part: an unarmed check is no longer a reason. Rejected in part: armed checks passing cannot lift an answer to "known" — that is "known" from silence again (R3-11). They give "consistent with the record". |
| Ship declared sources before the ask, or refuse `ask` unless sources are armed | practitioner review | The ask for a MISSING value needs no source check and is safe to ship first (step 4); the ask for an UNVERIFIED value arrives with sources (step 5). Refusing `ask` outright would withhold the owner's missing-value ask where it is sound. |
| A misquote whose value the library finds in the person's words should run, not ask | devil's review | A coincidental match is not provenance (engineer and research reviews). The step-5 bench measures how many asks misquotes cause; the quote rule is revisited if the number is high. |
| An ask per call, with the batch's other calls settled on resume | the arguments note | The owner's framing: one ask per batch, before anything runs. Nothing has run, so nothing needs settling, and ToolCalls can still pause afterwards. |
| The check inside ToolCalls, after permission and before-tool middleware | revision 1 | Superseded by the owner's subflow placement; its cost (the ask precedes permission) is stated and put to the owner (Q4). |
| The strict bar: any applicable check that did not run makes the answer "not sure" (`not-checked`) | revision 1 | Typical agents would read "not sure" on every answer and readers would learn to ignore it (devil's review). The printed `checked` list says what did not run; an armed check that could not run is still a reason. |
| The name `whenMissing` | revision 1 | `ask` also fires on a present value that cannot be traced once sources are armed (devil's review). |
| A library token match turning an undeclared value into `said` ("C6") | the arguments note | "We have 7 hosts" would have "said" `days: 7` (engineer and research reviews). It is a hint, `coincides`. |
| A stored assessment row on `AgentState` beside `answerGuarantee` | the honest-answer page, § 5.6 | A fold is derived, never stored (Fold law 2); the decisions memo § 2.2 already moved it to a pure reader. Only the witness rows the fold needs are stored. |
| The inputs layer as a Route branch that loops back to Route | the literal "between Route and ToolCalls" | footprintjs refuses a branch loop to anything not declared before the decider (`DeciderList._applyBranchLoop`), and the loop would run Route twice per batch and double its events. |
| ToolCalls moved into a subflow branch after the inputs layer | a way to put the layer right before ToolCalls | Armed runs would move ToolCalls' stage path under a subflow prefix and break every matcher keyed on the bare `tool-calls` id (agentfootprint CLAUDE.md, landmine 3). |
| The answer layer as its own node between Route and Final | the owner's wording | A decider branch is one node with no continuation. The layer heads the final branch instead (§ 5.2, Q3). |
| "Ask" as the rendering of every absence reason | the honest-answer page's rendering | At the answer the library cannot ask — it never replaces the model's reply. "Ask" is kept for a typed ask pending at the end of the turn (the library's or a tool's); an absence renders "not sure — what was searched". The page's "no idea → ask" for an unresolved subject returns with its step 3. |
| Reading the fold's verdicts from events | the post-run answer account's habit | The fold reads committed rows only, so the running agent and a later reader fold the same bytes; events-only verdicts gain one committed row when a step needs them. |

---

## 10. Open questions for the owner

**Answered 2026-09-27.** Each question below took its recommended answer (adopted overnight on the
owner's go; the owner may overturn). The answers are [decisions.md](decisions.md) Q1–Q12, and this
list's Q19 is decisions.md Q13. The questions stay here as they were put.

1. **The standing's values and words.** Four values from the honest-answer page, rendered as
   known · consistent with the record · not sure · ask · not assessed. It replaces revision 1's
   three values, which could say "known" from silence and had no value for "nothing was checked".
2. **Before declared sources exist**, a present but unverified value on an `ask` argument: flag it
   and run (this note), or ask (decision (b) read literally, at the cost of asking on nearly every
   call)?
3. **The answer layer's place.** The head of the final branch, with Final's output mapping carrying
   the layer's rows back to the ledger. The literal "between Route 'final' and Final" cannot be a
   separate node in footprintjs.
4. **The ask comes before permission.** Accept that a call permission later denies may have asked
   the person, or have the layer consult the permission checker first (a second policy call per ruled
   call)?
5. **Filled values enter the call before permission**, so policy judges the call that will run.
   This bends the written law "policy must see every attempted call": it sees the completed attempt.
6. **The one ledger:** `findingsLedger`, not renamed, plus a `turn` stamp on every row filed while a
   layer is armed, plus the restore wired whenever a layer is armed.
7. **The tier `said`**, defined as `claimed` text that a library check tied to a value, in one
   lattice: `claimed` ⊑ `said` ⊑ `answered`.
8. **A middleware that rewrites a ruled argument:** its value reads as assumed unless the middleware
   says where it came from. Add a typed origin to `allow(args, why, …)`, or not?
9. **Composed runs:** `said` counts only in runs whose caller passes the message as a person's; the
   composed patterns mark their runs.
10. **Public names, all open:** `askOrAssume` (`ask`, `assume`, `choices`, `said`); `_findings.from`
    (`user`, `result`, `turn`, `app`, `assumed`); `.findings({ argumentSources })`; `Tool.period` and
    `period` on the three doors (`spelling`, `readAt`); `agent.assessment()`;
    `agentfootprint.findings.argument`; `agentfootprint.answer.assessed`; `argumentAskContext`; each
    layer's builder option.
11. **The `describedResult()` questions** from the request: a shorter model note when there is no
    series; whether the model sees its `checked` list; a source and a time on `absent()`;
    `readEmptiness` in the `/observe` answer account. The results page ([results.md](results.md)
    § 10) answers each with a recommendation.
12. **Budgets:** the Haiku budget for the benches of steps 2, 4, 5 and 6 and the results cells R1–R4
    (R5 only if wanted), and whether step 1's parity test runs over the study's records now or
    after its freeze.
19. **A `ToolPeriod` on an argument with no rule** (numbered after the arguments note's own 13–18,
    so the two lists share numbers). Refused today (§ 3.2 (a)), so only a tool that
    rules its period argument (`ask` or `assume`) can get the results layer's `period-undeclared`
    check. Keep the refusal in v1, or allow a period on a free argument?

---

## Appendix — the review, finding by finding

Verdicts on the four-lens review. "Verified" means the finding's evidence was re-read in the code on
2026-09-26. Findings about the arguments note's own text that this note does not carry are marked
"arguments note".

| Finding | Severity · doc | Verdict | Where |
|---|---|---|---|
| engineer: the ledger carries into the next turn | MUST · both | verified (`Agent.checkpoint` → continue path → seed restore); applied | § 4.1, § 4.2 rule 5 |
| engineer: library notes launder a default into `result` | MUST · both | verified (`evidenceIndex.ts` · `indexResult` reads the whole tool message); applied | § 3.2 (c), (f); step 3 |
| engineer: `answeredByPerson` changes history bytes | MUST · arguments | rejected — ledger rows instead | § 9 |
| engineer: the `assume` check enforces the root `required` | MUST · arguments | verified (`validateToolArgs`); applied | § 3.2 (a) |
| engineer: a coincidental match becomes `said` | SHOULD · arguments | applied (`coincides`, a hint) | § 3.2 (c) |
| engineer: served sentences promise outcomes | SHOULD · both | applied | § 2.2 law 7; § 3.2 (g) |
| engineer: a `from`-only `_findings` is lost | SHOULD · arguments | verified (`readDeclaration`'s `readable`); applied | § 3.2 (b) |
| engineer: `commitWire` sees schemas only | SHOULD · arguments | verified (`mergeWire` returns name → party); applied | step 3 |
| engineer: restore gated on `.findings()`; two shapes | SHOULD · architecture | verified; applied (widened restore; the array shape wins) | § 4.1; § 3.2 (b) |
| engineer: a joined ask question can pass 4096 characters | SHOULD · arguments | applied (a fixed question) | § 3.2 (e) |
| engineer: one pause per resume | SHOULD · arguments | verified in footprintjs; resolved by the placement | § 3.2 (e) |
| engineer: `given` run facts as an app source | SHOULD · both | applied | § 3.2 (c) |
| engineer: fills must use a fresh object | NOTE | applied | § 3.2 (e) |
| engineer: record whether the cited result's tool is in `argumentsFrom` | NOTE | arguments note (a flag on the row, step 5) | — |
| engineer: a host cancel runs no fold | NOTE | verified (`hosting/standingAgent.ts`); applied | § 5.3 |
| engineer: "seven frames" | NOTE | verified (six prefixes plus `injectedBy`); cite with no count | § 2.2 law 3 |
| engineer: two doc comments change meaning | NOTE | applied | step 3 |
| devil: a reading bypasses the ask | MUST · both | applied (a reading asks; author-declared phrases) | § 3.2 (c), (d) |
| devil: `tokenize` over compact JSON | MUST · arguments | verified by running it; applied (the index's per-result reading) | § 3.2 (c) |
| devil: an unvouched empty result reads as known | MUST · architecture | applied (`empty-undeclared`; four values) | § 4.2 |
| devil: raw values bypass the argument view | MUST · arguments | verified (no agent-level redaction policy; `findings()` clones); applied | § 3.2 (h) |
| devil: the ask fires too often; answered values get evicted | SHOULD · arguments | applied (hint only; ledger rows; step-4 ask-rate bench) | § 3.2 (d); § 4.1 |
| devil: the quote check is too strict | SHOULD · arguments | partly applied (hint kept); fallback rejected | § 3.2 (c); § 9 |
| devil: middleware turns a guess into `app` | SHOULD · arguments | applied (checked before middleware; a rewrite reads as assumed) | § 3.2 (e); Q8 |
| devil: composed patterns write the "person's" message | SHOULD · both | verified (`reflection`); applied | § 2.2 law 3; Q9 |
| devil: quadratic ledger cost | SHOULD · both | verified (`recordFindings`; `applyOutputMapping`); applied | § 4.1 |
| devil: a phantom read in PrepareFinal | SHOULD · arguments | verified; applied | § 2.2 law 9; § 3.2 (f) |
| devil: two-way import between folders | SHOULD · both | applied (`arguments/` is a leaf) | § 3.2 (h); § 5.5 |
| devil: the two notes contradict; clause 7 | SHOULD · both | applied | § 2.1; step 3 |
| devil: "known" strict in the wrong place; two composers | SHOULD · architecture | partly applied; part rejected | § 4.2 rule 3; § 3.2 (f); § 9 |
| devil: `whenMissing` misleads | SHOULD · arguments | applied (`askOrAssume`) | § 3.2 (a) |
| devil: `given` from the declared-control page | NOTE | applied | § 3.2 (c) |
| devil: the declarations rule is contradicted | NOTE | applied | § 2.2 law 8 |
| devil: public surfaces widen | NOTE | applied | § 4.1 |
| devil: `integer` asked as `number`; strip helpers; window-relative turn | NOTE | integer: arguments note (re-check at bind, pause again); strip helpers: moot; turn: the conversation turn, not a window position | § 4.1 |
| practitioner: MCP is the production path | MUST · both | verified (`McpToolExtras`; the host's catalog); applied | § 3.2 (a); step 3 |
| practitioner: a middleware default outranks `assume` | MUST · arguments | applied | § 3.2 (e), (h) |
| practitioner: the ask before sources asks too often | MUST · both | applied (unarmed flags); alternatives rejected | § 3.2 (d); § 9 |
| practitioner: the host serves counts, not appended prose | SHOULD · both | verified (`coverageMark.ts`; the dropped arm); applied | § 3.2 (f); § 3.4 |
| practitioner: a library ask loses the host's state | SHOULD · both | verified (`brain.ts` → `restoreInputPause`); applied | § 3.2 (e) |
| practitioner: one period, many spellings; freshness horizons | SHOULD · both | verified (`-24h` ≠ `24h`); applied | § 3.3 |
| practitioner: `queried` must be the read, not the call | SHOULD · arguments | verified (`_influx_checked`); applied | § 3.3 |
| practitioner: position against the host's flow | SHOULD · both | verified (`queryWindowFlow.ts`); applied | § 3.2 (i) |
| practitioner: `from` planted on every tool | SHOULD · arguments | applied | § 3.2 (b) |
| practitioner: a default in two places | NOTE | arguments note (migration section) | — |
| research: the fold undoes the four-valued assessment | MUST · architecture | applied | § 4.2, § 4.3 |
| research: a presence check counted as support | MUST · both | applied | § 1.1; § 4.2 rule 2; § 3.2 (h) |
| research: the trust base is unstated | SHOULD · both | applied | § 1.2 |
| research: no outside truth; no baseline | SHOULD · architecture | applied | § 6.3 |
| research: the generality claim outruns the evidence | SHOULD · architecture | applied | § 6.3 |
| research: free-text answers counted as support | SHOULD · arguments | applied (`free`, never support) | § 3.2 (h) |
| research: missing related work | SHOULD · architecture | applied, citations to verify before use | § 6.3 |
| research: one vocabulary for the paper | NOTE | applied (the array form) | § 3.2 (b) |
| research: `said` beside `claimed` | NOTE | applied (the lattice) | § 3.2 (h); Q7 |
| research: the seven clauses are the method | NOTE | kept | § 2; § 6.3 |
