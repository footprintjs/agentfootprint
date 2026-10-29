# Code in an answer — the script artifact

**Design for review. Not approved to implement.** Nothing in this page is built.
Approval to review it is not approval to implement it. Written 2026-10-28 from the
revised H1 requirement, which folds in two rounds of review; revised 2026-10-29 to answer
the review of PR #235 at `4ad0184d6` (verdict: changes — the match rule, the execution
labels and the matching bound). It extends the evidence gate
([src/core/agent/evidence/](../../src/core/agent/evidence/README.md)) and the answer
layer ([src/core/agent/assessment/](../../src/core/agent/assessment/README.md)); it is
not a second check. The build follows in its own PR, after review.

Code is cited as `file · symbol`, under `src/`. A name marked † does not exist yet: it
is this page's proposal, and the build may rename it.

## For the owner

1. **The problem.** A data agent runs a script through a code-running tool and hands
   the script back in the answer, in a fenced block, because the app's rule is "always
   show the script". The names-and-numbers check reads the whole answer as prose. So a
   Python format specification (`{mean:.2f}` reads as the identifier `mean:.2f`) and a
   constant in the code (`0.01`, `sample(10)`) become values to ground. No tool result
   carries them: the script was a tool-call ARGUMENT, which is rightly not evidence. Under
   `guard` the answer takes a revision it did not need, the values survive it, and the
   answer is labelled "not sure" for no fault of its own. In the field, correct answers
   took a revision for this alone.
2. **The risk beyond the label.** The cheapest revision that passes the check is to
   delete the script. The app's own rule breaks, and the person loses the one thing that
   lets them re-run the computation.
3. **What this page proposes.**
   - Four facts stay separate: "this is the script submitted", "this script ran", "the
     tool returned this value", "this claim holds". Code is never evidence for a value.
   - **Preferred:** the library attaches the recorded script itself, under the answer,
     labelled from the execution record (`.scriptTravelsWithTheAnswer()`†). The model
     never retypes it, so there is nothing to check.
   - **When the model writes a fenced block anyway:** under `code: 'match'`† the block is
     matched, byte for byte after removing only the Markdown wrapper, against ONE recorded
     execution of a declared code-running tool in the current turn. A match makes the
     block script content: no value candidates, labelled with that execution's outcome. A
     miss leaves the block prose, checked as today, labelled as not a recorded execution
     of this turn.
   - Execution evidence is kept apart from call settlement and result delivery: five
     labels, and a confirmed completion stays confirmed when its result is withheld.
   - Inline code spans and unclosed fences are prose. Formatting alone exempts nothing.
   - `code: 'check'` (the default) is today's behaviour, byte-identical.
   - The recovery message says: keep the script, fix the values.
4. **What it does not do.** It does not say a value belongs to the subject the answer
   names. That is V1 (value binding), and § 11 says what room the record leaves for it.

## 1. Why

### 1.1 The failure

The gate's extractor (`core/agent/evidence/extract.ts` · `readAnswer`) tokenizes the
answer and classifies every token with a digit (`extract.ts` · `classifyToken`). It has
no notion of a code region. A fenced script contributes:

| in the script | read as | shape |
|---|---|---|
| `{mean_latency_ms:.2f}` | `mean_latency_ms:.2f` | identifier |
| `{ratio*100:.1f}` | `100:.1f` | identifier |
| `p < 0.01` | `0.01` | number (under `decimalRounding`) |
| `df.sample(10)` | `10` | prose below `minDigits` — not flagged |
| `threshold = 1200` | `1200` | number — flagged unless a result carries it |

None of these is in a tool result, so each is `unsupported`. The host app worked around
the first two with an `exempt` pattern for format specifications. That pattern cannot
cover constants, and an exemption is a rule about spelling, not about where a token
sits.

### 1.2 Why the obvious fixes are wrong

- **Exempt everything in a fence.** A fence is three characters the model types. "The
  latency was `240 ms`" and ```` ```text ```` around a sentence would exempt any claim.
  Both reviews refused this.
- **Ground code tokens from call arguments.** The original field spec proposed it. It
  lets an invention launder itself: type a value into a script, run it, show the script.
  The arguments are not evidence (`core/agent/evidence/evidenceIndex.ts`, header:
  "Tool call ARGUMENTS do not count"), and gathering tokens from every call's arguments
  would make one failed lookup ground anything. Both reviews refused this too.
- **Match a block to "a call that ran similar code".** `core/codeRunnerTool.ts` ·
  `codeShape` erases literals on purpose, so an altered constant hashes to the same
  shape. A shape match would accept exactly the altered script § 9 refuses.
- **Match after "harmless" normalizations.** The first draft of this page stripped
  trailing spaces and applied NFC before comparing. The review's probe shows both change
  a program: `print(len("""A  \nB"""))` prints 5 and its copy without the two trailing
  spaces prints 3; `print(len("é"))` prints 2 and its NFC form `print(len("é"))`
  prints 1. A language-neutral match cannot touch the bytes inside the program.

### 1.3 The direction

A displayed script is a claim about ONE execution: "this is what I submitted to the code
tool, and it ran". The record holds that execution — its `code` argument, its call id,
what the runner reported. So the check is identity against the record, not evidence for
values. And where the app requires the script, the library should put it there from the
record, so the model has nothing to retype.

## 2. What exists, and what this design builds on

| Today | Where | What this design does with it |
|---|---|---|
| The code-running tool | `core/codeRunnerTool.ts` · `codeRunnerTool`: one `code` string argument, the port `provider-contract/types.ts` · `CodeRunner` / `CodeSession` / `CodeResult` | Declares itself code-running (§ 4.1). Unchanged otherwise. |
| The execution facts | `codeRunnerTool.ts` · `CodeRunFacts` (`ok`, `truncated`, `outputChars`, `shapeHash`, never the code), consumed by the dispatch loop right after `tool.execute` returns (`core/agent/stages/toolCalls.ts`, where `codeRunsOf` is read) and emitted as `agentfootprint.tools.code_run` (`events/payloads.ts` · `ToolsCodeRunPayload`) | The execution label is read from these facts, and only from them (§ 4.3). The code stays off the event. |
| Result delivery | `toolCalls.ts` · `refuseOverCeiling` — the tool's own ceiling, applied at the same execute boundary AFTER the handler's return has landed; it replaces the payload on every channel and files `tools.result_refused` | A refused result does not undo a completed execution: the facts were taken before the refusal (§ 4.3). |
| Where the arguments are recorded | the assistant message's `toolCalls[].args` in `history` (`provider-contract/types.ts` · `LLMMessage`); `stream.tool_start.args` (`events/payloads.ts` · `ToolStartPayload`); `llmLatestToolCalls`, `pausedToolArgs` on `AgentState` | The script text is read from the record, never re-asked of the model (§ 6). |
| The evidence corpus | `evidenceIndex.ts` · `evidenceFromHistory`: `role: 'tool'` turns only, structural walk, token-exact | Unchanged. Code is never added to it. |
| The judge | `core/agent/stages/route.ts` · `judgeEvidence` builds the corpus and the exempt set once and hands one closure to `core/agent/evidence/gate.ts` · `checkAnswer`; answer validation's `'names-and-numbers'` asks the same closure of the delivered candidate (`core/agent/stages/answerEvidence.ts`) | The match runs inside that closure, so the draft and the delivered candidate are judged alike (§ 5). |
| The recovery message | `core/agent/evidence/recovery.ts` · `buildEvidenceRecovery`, request-only; the figures dial's late line (`evidenceConclusionLine`) | Gains one clause under the new mode (§ 7). |
| The one composer of what travels with a prose answer | `semantics/coverage/answer.ts` · `composeAnswerWithCoverage`: standing line, limits block, assumed block, under one `---` separator; chosen by `core/agent/stages/prepareFinal.ts` · `prepareFinalFor` | Appends the attached script (§ 4.2). |
| The standing | `core/agent/assessment/assess.ts` · `assessAnswer` over committed rows; the closed table `reasons.ts` · `REASONS`; the line `compose.ts` · `standingLineOf` | Gains one reason and one check (§ 6). |
| The answer account | `answer-account/account.ts` · `accountForAnswer`; the "How sure" row `answer-account/facts/howSure.ts` · `readHowSure` | Gains script lines (§ 6). |
| A tool's declarations | `tools/tools.ts` · `DefineToolOptions` (`askOrAssume`, `period`, `search`, `effects`, …); judged at three doors (`tools/declare.ts`, header) | A new declaration, `script`† (§ 4.1). |

## 3. The four facts

| # | Fact | Established by | Supports | Never supports |
|---|---|---|---|---|
| F1 | The displayed script is the one submitted | the block's content equals, byte for byte, the `code` argument of ONE recorded call of a declared code-running tool in this turn (§ 5.2) | "This is the script submitted." | that it ran; any value |
| F2 | That script ran | the runner's own facts for that call: `completed` or `completed-with-failure` (§ 4.3). `returned` supports only "the tool call returned"; `submitted` and `outcome-unknown` support nothing about running | "This script ran." | what it printed; any value |
| F3 | A tool returned this value | a `role: 'tool'` result carries the value — the corpus as today | "The tool returned this value." | that the value is about the claimed subject |
| F4 | The factual claim | V1: the value matches the subject, field, time and coverage asked about | the claim | — |

How they stay separate:

- **In the record.** F1 and F2 are facts about an EXECUTION, on one row per execution
  (`script`† row, § 6). F3 is the gate's verdict (`unsupportedValues`, `evidence_checked`)
  and is computed from `role: 'tool'` results only. Nothing from an F1/F2 row enters the
  evidence corpus or the exempt corpus. F4 has no row; § 11.
- **In the answer account.** F1 and F2 are one line per shown or attached script, vouched
  by the library (the match) and the tool (the outcome). F3 keeps today's evidence lines.
  No sentence joins them: "the script shown completed" and "the values were read from
  results" stay two sentences.
- **In the standing.** A matched script fires nothing and supports nothing (a membership
  pass never supports "known" — rule 2 of the fold). An unmatched script fires a reason
  (§ 6). A flagged value is `value-unsupported`, as today.

The one sentence the design never allows: "the script shows where the value came from".
A script that ran `print(99999)` proves it printed 99999, not that revenue was 99999.

## 4. The library-rendered artifact

### 4.1 Declared, never inferred

**A tool is code-running because it says so.** A new declaration on the tool:

```ts
// tools/tools.ts · DefineToolOptions (proposed)
readonly script?: { readonly argument: string; readonly language?: string };
```

`argument` names the ONE string argument that carries the program. `codeRunnerTool`
declares `script: { argument: 'code', language }` on the tool it builds. A hand-built or
MCP-served code runner declares it the way `askOrAssume` and `period` are declared and
judged (`tools/declare.ts`, the three doors: definition, dispatch, MCP ingest). Refused at
build when `argument` is not a declared string property of the input schema.

The library never infers it from a tool's name (`run_code`), from a property named
`code`, or from the description. A tool that executes code and does not declare it has no
executions on the record for this design: a block the model shows is then prose, as today.

**The app asks for the script that ran** with an arm beside the limits block's:

```ts
Agent.create({ provider, model })
  .tool(codeRunnerTool({ runner }))
  .namesAndNumbersFromEvidence({ posture: 'guard', code: 'match' }) // § 6 of this page
  .scriptTravelsWithTheAnswer({ which: 'last', maxChars: 4000 })     // the attachment
  .build();
```

- `which: 'last'` (default) — the last execution of the turn that reached the tool;
  `'all'` — every execution of the turn, at most `MAX_ATTACHED_SCRIPTS`† (8), the rest
  counted on `turn_end.scripts` as `omitted`†. There is no `'cited'` in v1 and no silent
  fallback from one (§ 13, answer 1).
- `maxChars` (default 4,000, the same number as `codeRunnerTool`'s `DEFAULT_MAX_OUTPUT_CHARS`)
  bounds the text shown; a cut is stated and the cut attachment is visibly incomplete
  (§ 4.4).
- Refused at build when no registered tool declares `script`: an arm that could never
  attach anything is a misconfiguration, not a no-op.

### 4.2 Where the script is attached

Two forms, like the limits block (`.limitsTravelWithTheAnswer()`): data always, text on
a prose answer.

**As data.** `turn_end` gains `scripts`† (present only under the arm):

```ts
readonly scripts?: {
  readonly shown: readonly {
    readonly toolCallId: string;
    readonly tool: string;            // the name the model called
    readonly language?: string;       // as declared
    readonly label: 'submitted' | 'returned' | 'completed' | 'completed-with-failure' | 'outcome-unknown';
    readonly resultWithheld?: 'over-ceiling';
    readonly rewritten?: true;        // a before-tool middleware changed the program
    readonly chars: number;           // of the whole program
    readonly lines: number;
    readonly truncated?: { readonly shownChars: number };
    readonly text: string;            // the program, cut at maxChars
  }[];
  readonly omitted: number;           // executions of this turn not attached (the cap, or over-size)
};
```

A host that renders its own code block reads this and never parses the answer text.
`text` is a model-written string: under ANY redaction policy the value-kind rule serves
it as the placeholder (`redaction/knownStrings.ts` · `keepKnownValues`), and the label,
the ids and the counts survive.

**As text, on a prose answer.** `composeAnswerWithCoverage` appends one block per
attached script under the `---` separator, after the standing line and the limits block:

````md
---

Not sure — names or numbers in the answer appear in no tool result.

Script run_code completed (exit 0, call c1), attached by the library from the run record:

```python
import json, os
rows = json.load(open(json.loads(os.environ['AF_STAGED_INPUTS'])['dataset']))
print(f"{sum(r['amount'] for r in rows):.2f}")
```
````

The fence is `max(3, longestRun + 1)` backticks, where `longestRun` is the longest run of
backticks inside the program (the CommonMark closing rule), so a program that contains
```` ``` ```` cannot close the library's block early. The program's bytes are written
unchanged between the fence lines; a program ending in a line break is rendered with an
empty line before the closing fence, so what sits between the wrapper is the program
exactly (§ 5.2). The label line is library-authored and past-tense, like the limits
heading, uses the execution label's words, and names the call, never a destination. A
typed answer (`.outputSchema()`) gets the data only; the answer is never edited — the
same law as the standing line.

**Weighed.**

| Concern | Text appended | Typed attachment |
|---|---|---|
| What the person sees | the script, in the chat, with its label — no host work | only what the host renders |
| Memory | `captureTurnPayload` persists the composed answer as the assistant turn (`newMessages`), so the script is in memory and in every later turn's context. The app asked for it; the bound is `maxChars`. The standing line's rule holds: memory keeps exactly what was delivered. | nothing in memory beyond what the model wrote |
| Streaming | nothing appended is streamed: `prepareFinal.ts` · `captureTurnPayload` releases one `stream.token` only for a validated or policy-released answer, and the composed section is not part of the streamed draft. The script arrives with the returned string and `turn_end`. | the same event |
| The answer account | the account finds the block by rebuilding it from the record (the standing line's rule: `answer-account/account.ts` reads the line through `standingLineOf`, never by matching words) | read from `turn_end.scripts` |

Decision: both, as the limits block does. The text form is what makes "always show the
script" true without the model's cooperation; the data form is what a host with its own
renderer wants. When the model also wrote a matched block, the attachment is still
appended: the model's copy never decides whether the authoritative one is delivered
(§ 13, answer 2).

### 4.3 The labels — execution evidence, call settlement and result delivery are three things

The record holds three separate facts about a code call, written by three separate
mechanisms:

| Fact | Written by | Carries |
|---|---|---|
| execution evidence | the runner, through the tool's facts (`codeRunnerTool.ts` · `CodeRunFacts`, taken in `toolCalls.ts` where `codeRunsOf` is read, right after `tool.execute` returns) | `ok` — exit 0 (`adapters/code/local.ts`: `exitCode === 0`; `adapters/code/agentcore.ts`: `isError !== true` and `exitCode === 0`) or not |
| call settlement | the dispatch loop: `stream.tool_end` (`error`, `notDispatched`), `toolResultOrigin` on the result message, the batch settlement | whether the call returned, threw, timed out, was cancelled, or never ran |
| result delivery | `toolCalls.ts` · `refuseOverCeiling` (`tools.result_refused`), the agent cap | whether the returned payload reached the model whole, cut, or not at all |

A label is read from the first fact where it exists, and never from the other two:

| Label | Words | The record says |
|---|---|---|
| `submitted` | "submitted" | the program is on the record and the call has not returned: never dispatched (`notDispatched`, the batch settlement), refused before `execute` (`toolResultOrigin: 'not-entered'`), or still open (`'input-cancelled'`, `'outcome-unknown'`). |
| `returned` | "tool call returned; execution not confirmed" | the tool returned a result and filed no runner facts — a declared code-running tool that is not `codeRunnerTool`, or any tool whose handler returned without executing its argument. The call completed; nothing proves the program ran. |
| `completed` | "completed (exit 0)" | runner facts with `ok: true`. |
| `completed-with-failure` | "completed with failure (exit N)" | runner facts with `ok: false`: a non-zero exit (`codeRunnerTool` renders `[exit N]`) or the service's own error verdict, after possible partial work — the program ran to an exit; what it did before that exit is not known from the exit. |
| `outcome-unknown` | "outcome unknown" | the call ended with no runner facts: a timeout, a cancellation, or a thrown error. `localCodeRunner` kills the child at `timeoutMs` and then rejects, so no facts are filed; a remote runner may finish the program after the caller stopped waiting; a thrown error before the runner was reached (an interpreter missing, a staging refusal) files nothing either. The record cannot say whether the program ran, so the label says that. |

Two consequences the earlier draft got wrong:

- **A withheld result does not undo a completion.** `refuseOverCeiling` runs on the
  returned payload after the facts were taken, so a script that completed and whose
  output was refused over the tool's ceiling is `completed` with
  `resultWithheld: 'over-ceiling'`. The person is told both: the program ran, and its
  output was not delivered.
- **A timeout is not "did not finish".** Without runner evidence of termination the
  outcome is unknown. A runner that can prove termination (the local child was killed)
  files no such fact today; adding one is a follow-up, named in § 12.

"Submitted" never means "did not run"; "returned" never means "ran". A reader must not
promote a label to its neighbour.

### 4.4 Bounds, and the run's redaction rules

- **Per script.** `MAX_SCRIPT_CHARS`† (32,768) at RECORD time: an execution whose program
  is longer keeps a row with `chars`, `lines` and the outcome, and no text. It can be
  neither matched (§ 5.3, `over-size`) nor attached; the attachment counts it in
  `omitted` and the text form says "one script of N characters is over the bound and is
  not shown". A data script is a few kilobytes; a 100 KB "script" is a pasted table.
- **Per turn.** `MAX_SCRIPT_ROWS`† (16) executions keep a row; the rest are counted
  (`scriptsDropped`† on the turn's rows) and are unmatchable.
- **Retained text.** A row's `text` is kept for its own turn only: at the next turn
  boundary (the seed stage) the row keeps its facts — ids, counts, outcome — and loses its
  text. So the text the ledger retains is at most `MAX_SCRIPT_ROWS × MAX_SCRIPT_CHARS`
  = 512 KiB at any time, whatever the conversation's length, and a checkpoint carries at
  most that.
- **The total bound.** Matching is current-turn only (§ 5.2): at most
  `MAX_CODE_REGIONS`† (32) regions against at most 16 rows = 512 byte-equality
  comparisons per judged answer, each of at most 32,768 bytes, plus one linear scan of
  the answer. Earlier turns add nothing to this work.
- **Attached text.** `maxChars` (4,000 by default): the first `maxChars` characters, then
  `[incomplete: showing N of M characters — not the whole program]`. A cut attachment is
  never advertised as a complete, reproducible program; `truncated.shownChars` says so as
  data.
- **Redaction.** A policy selects by NAME. The script text travels under names the
  vocabulary already selects — `args` on the stream events, `toolCalls[].args` inside
  `history`, `llmLatestToolCalls`, `pausedToolArgs` — and under one new one, the
  `script`† row's `text` field, which `redaction/conversation.ts` · `conversationRedaction`
  gains. In the run, the gate reads the live heap, which no policy covers, so matching
  works under any policy. After the run, a reader of a record under a policy finds the
  placeholder: the account says the script is KEPT OUT (law 11 of
  `answer-account/README.md`), never "no script ran". The attached text rides the answer
  `run()` returns, which no policy covers either; the event copies (`turn_end.finalContent`,
  `turn_end.scripts.shown[].text`) are kept out as the answer is.
- **Exporters.** `agentfootprint.tools.code_run` carries no code and keeps carrying none;
  the OTel adapter withholds a code runner's arguments (`adapters/observability/otel.ts`,
  its `captureToolContent` rule). The attachment reaches an exporter only as answer text,
  which the app chose to show.

The numbers are starting proposals, not measured guarantees (§ 13, answer 8).

## 5. Model-written fenced blocks

### 5.1 Code regions

Under `code: 'match'`†, a prose answer is scanned once, line by line, for fenced code
blocks, and nothing else:

- An opening fence is a line that starts at column 0 with three or more backticks, or
  three or more tildes, followed by an optional info string. A backtick fence's info
  string may not contain a backtick.
- The closing fence starts at column 0, uses the same character, is at least as long, and
  carries nothing else but spaces.
- The region's content is the bytes between the two fence lines (§ 5.2 says exactly
  which bytes).
- A fence that never closes is NOT a region: the text from it to the end is prose.
- An inline span (`` `240 ms` ``) is prose. An indented code block (four spaces) is prose.
  A fence with any leading spaces (CommonMark allows up to three; inside a list item) is
  prose in v1: taking its content "as written" and taking it "with the indentation
  removed" are two different byte strings, and the rule here may not choose one.
- At most `MAX_CODE_REGIONS`† (32) regions are read; the rest are prose and counted.

The scan is linear in the answer (`lib/linearText.ts`'s law; pinned the way
`test/security/linear-scanners.test.ts` pins the shape reducer's scans). It lives in a
new leaf, `core/agent/evidence/codeRegions.ts`†, with no imports from the gate.

A typed answer (`.outputSchema()`) is not scanned in this version: its string values are
read as today (§ 12).

### 5.2 The match rule: exact, after removing only the wrapper

A region matches an execution only if its content equals the recorded program text byte
for byte. The only thing removed from the answer before the comparison is the Markdown
wrapper:

- the opening fence line, with its info string and its line break;
- the line break that precedes the closing fence line, and the closing fence line itself.

Everything between is the content, exactly as written: every space, tab, line break,
line ending and Unicode code point. A program that ends in a line break is therefore
shown with an empty line before the closing fence (what § 4.2's renderer writes).

No transformation of any kind: no trailing-whitespace stripping, no line-ending
rewriting, no Unicode normalization, no case folding, no indentation change, no comment
or blank-line removal, no `codeShape`, no edit distance. Each of these can change a
literal and so the program: the review's probe (`normalization_probe.py`) shows
`print(len("""A  \nB"""))` printing 5 while the copy without the two trailing spaces
prints 3, and `print(len("é"))` printing 2 while its NFC form prints 1. A copy that
differs by one such byte is a different program, and this page never calls it identical.
`tokenize` and `normalizeToken` (`lib/normalize.ts`) play no part: this is identity of a
program, not spelling of a value.

The comparison runs against the `script`† rows of the CURRENT TURN only (§ 13, answer 9).
Rows of earlier turns are not compared; their count is reported (`earlierTurnRows`†) and
a miss is never described as "no execution", only as no execution of this turn.

The row's text is the program the tool EXECUTED. `toolCalls.ts` files the row at the one
execute boundary (the `declareCoverage` precedent) from the arguments handed to
`tool.execute`, after any before-tool middleware. When a middleware rewrote the script,
the row says `rewritten: true`, the model's original (still in `history`) is not a match,
and the record does not reveal the earlier text: a rewrite can remove material on
purpose (§ 13, answer 7).

### 5.3 What a match yields, and what a miss yields

**A match.** The region is script content. It is removed from the text the extractor
reads, so it yields no value candidates, and `evidence_checked.scripts`† lists it with
the execution's label:

```ts
{ block: 2, label: 'completed', toolCallId: 'c1', tool: 'run_code' }
{ block: 3, label: 'outcome-unknown', toolCallId: 'c2', tool: 'run_code' }
```

The corpus is untouched: a value in the prose that also sits in the script still needs a
result. Constants in a matched script are script content, never findings. A format
specification inside a matched block is covered by this rule, so no special case for the
`{x:.2f}` shape exists anywhere, in any mode — the original field spec's "known to the
extractor in every mode" would have changed `check` mode's bytes.

**A miss.** The region stays in the text and is checked as prose, exactly as today, and
it is labelled:

```ts
{ block: 2, label: 'unmatched', reason: 'no-execution-this-turn' }  // equals no row of this turn
{ block: 2, label: 'unmatched', reason: 'over-size' }               // a row of this turn with no text
{ block: 2, label: 'unmatched', reason: 'kept-out' }                // after the run, a redacted row
```

Nothing names a nearest execution: a "differs from call c1 by N lines" line would be a
near match by another name, and v1 has none (§ 13, answer 4). Each `unsupported` value
gains `region: 'prose' | 'code'`† (`'code'` when every occurrence of the value is inside
unmatched regions), present only under `code: 'match'`.

**Two executions alike.** Two rows of this turn with byte-identical programs (the model
re-ran the same script): the block is the script of each; the verdict names the latest
one (the newest call id), counts the rest (`alsoMatches: 1`), and carries the named
execution's label. Two rows that differ by any byte are two programs, and a block equals
at most one of them.

### 5.4 Where the match runs

Inside the one judge closure in `route.ts` · `judgeEvidence`, before `checkAnswer` reads
the text: the regions are found, matched against this turn's rows, the matched ones cut
out of the text, and the verdict carries `scripts`. Answer validation's
`'names-and-numbers'` row asks the same closure, so the delivered candidate is read the
same way as the draft. The contingent check (`core/agent/findings/contingent.ts`) reads
`verdict.grounded`, which a matched block never adds to.

## 6. The option, the record, the standing, the account

### 6.1 The option

```ts
// core/agent/evidence/types.ts · NamesAndNumbersOptions (proposed)
readonly code?: 'check' | 'match';
```

| mode | behaviour |
|---|---|
| `'check'` (default) | today's: the whole answer is prose. Byte-identical to 11.x — the verdict, the events, the recovery message, every reference under `test/core/tools/reference/`. |
| `'match'` | § 5: fenced regions matched against this turn's recorded executions; matched ones are script content; the rest prose. |

No `'skip'`: skipping every fence is an exemption by formatting. `resolveEvidenceGate`
refuses any other value by name. `'match'` without a tool that declares `script`† is
accepted (a block is then always a miss) and warned about once in dev mode.

### 6.2 The record

**One row per execution** of a declared code-running tool, on `findingsLedger`, filed by
`toolCalls.ts` at the execute boundary while either arm is on (`code: 'match'` or the
attachment). A new member of `core/agent/findings/types.ts` · `FindingsRow`, beside
`ArgumentRow` and `PeriodRow`:

```ts
interface ScriptRow {                       // proposed
  readonly kind: 'script';
  readonly toolCallId: string;
  readonly tool: string;                    // the name the model called
  readonly argument: string;                // the declared argument
  readonly language?: string;
  readonly chars: number;
  readonly lines: number;
  readonly text?: string;                   // absent over MAX_SCRIPT_CHARS, and after the row's turn ends
  readonly outcome: 'submitted' | 'returned' | 'completed' | 'completed-with-failure' | 'outcome-unknown';
  readonly exitCode?: number;               // from the runner facts, when they carry one
  readonly resultWithheld?: 'over-ceiling'; // refuseOverCeiling replaced the delivered result
  readonly rewritten?: true;                // a before-tool middleware changed the program
  readonly turn: number;
  readonly iteration: number;
}
```

The outcome is written when the call settles (the five `tool_end`-emitting paths and the
batch settlement, `core/agent/stages/README.md`): the runner facts first, then — only
when there are none — the settlement. A row that never settles stays `submitted`. The row
crosses a pause: the ledger is in the checkpoint. The row survives a window strategy:
compaction never touches the ledger, which is why the text is on the row and not read
back from `history`; and the text is dropped at the next turn boundary (§ 4.4), so what
the ledger retains stays bounded.

**The verdict and the event.** `EvidenceVerdict` and `agentfootprint.agent.evidence_checked`
gain `scripts`† (§ 5.3: the blocks, `earlierTurnRows`, `regionsDropped`) and
`unsupported[].region`†, present only under `code: 'match'`. Never the code text on the
event.

**The attachment.** `turn_end.scripts`† (§ 4.2), present only under the arm.

**The standing.** One reason joins the closed table `reasons.ts` · `REASONS`:

| Reason | Layer | Class | Read from |
|---|---|---|---|
| `script-unmatched`† | 4 | not-sure | `findingsLedger`: a `script-shown`† witness row of this turn with `label: 'unmatched'` — filed by the Route decider while the answer layer is armed, as `grounded` and `steps-unfinished` are (`core/agent/assessment/witness.ts`) |

It stays its own reason and its own class: a script can fail to match while every number
in the answer is in a result, and an unsupported value is a different finding (§ 13,
answer 6). `checked` gains `script-match`† (layer 4): `of` = regions found, `ran` =
regions matched or missed (every region reaches a verdict). A matched region fires
nothing and supports nothing. The line's words (`compose.ts` · `REASON_WORDS`): "a script
shown in the answer matches no execution of this turn on the record"; the check's word
(`CHECK_WORDS`): "scripts shown". `STANDING_LINE_VERSION` is bumped. The equality law
holds: the in-run standing equals `assessAnswer()` over the same rows
(`test/core/agent/assessment/answer-layer-equality.test.ts` gains the case).

**The answer account.** The "How sure" row (`facts/howSure.ts`) gains, beside the
evidence lines, one line per shown or attached script, from the templates table with a
version bump (`answer-account/templates.ts`), one template per label:

- "The script shown is the one submitted on `run_code`'s call c1; it completed (exit 0)."
  — voucher `tool:run_code` for the outcome, `library` for the match; the sentence takes
  the weaker, `library`.
- "… it completed with failure (exit 1)." · "… the tool call returned; execution is not
  confirmed." · "… its outcome is unknown: the call ended before the runner reported." ·
  "… its result was withheld over the tool's ceiling; the execution itself completed."
- "A before-tool rule changed the script before it ran; the script shown is the changed
  one." — said whenever `rewritten` is set; the earlier text is not shown.
- "A script shown matches no execution of this turn; its 3 values were checked as prose."
- "The script under the answer was attached by the library from the record of `run_code`'s
  call c1 (completed, 412 characters)." · "… (showing 4,000 of 9,310 characters — not the
  whole program)."

"Show me" (`answer-account/shown.ts` · `SHOW_ME_ALLOW_LIST`) points at the row's label,
outcome and counts; the `text` is a tool argument and stays on the deny list.

**The standing line.** Unchanged when nothing fires. When the only reason is
`script-unmatched`:

> Not sure — a script shown in the answer matches no execution of this turn on the record.

## 7. The recovery message

Under `guard` and `rails`, `buildEvidenceRecovery` composes one request-only instruction.
Under `code: 'match'` it gains one clause, after "Recovery action: replace the rejected
draft", chosen by what the verdict holds:

- **An unmatched region whose values were flagged:**
  > The fenced code in the rejected draft matched no execution of `run_code` recorded this
  > turn, so its contents were checked as prose. Keep a script in the answer: show the
  > program exactly as it was submitted on that call, byte for byte, or say that the code
  > shown is not the one that ran. Fix the values in the prose.
- **A matched region, with values flagged in the prose:**
  > The script shown is the one submitted on `run_code`'s call c1 (it completed with
  > failure, exit 1) and was not checked. Keep it. The listed values were in the prose
  > around it.

  The parenthesis carries the execution's actual label and words (§ 4.3), never a fixed
  "executed".

The values are listed as today, each with its `region`. The clause is a library sentence
about a finished call, in the past tense, and names no tool as where to go next
(`core/agent/README.md`, the correction law). It is registered in
`test/modelFacingSurfaces.test.ts`, like every model-facing composer.

What the clause cannot do, stated: deleting an unmatched block removes its candidates
and the `script-unmatched` reason, so a draft without the script can pass the check. No
prompt sentence makes a model keep a script. Mandatory display comes from the attachment
(§ 4), which needs no cooperation from the model.

## 8. Determinism and cost

The scan and the match are pure functions over the answer and this turn's rows: no
model, no clock, no randomness. The scan is one pass over the answer's lines; the match
is at most 512 byte-equality comparisons per judged answer (§ 4.4, the total bound), each
on strings of at most 32,768 bytes, and a comparison stops at the first differing byte or
at a length mismatch. Under `code: 'check'` none of it runs.

## 9. Threat model

| # | Threat | What happens | Residual |
|---|---|---|---|
| 1 | **Laundering a value through call arguments.** The model types `revenue = 99999` into a script, runs it, and shows the script. | The corpus never indexes arguments. A matched block yields no candidates for itself, and nothing for the prose: "revenue was 99999" in the prose is flagged unless a result carries it. The only thing a match buys is silence about the script's own text. | The script's output is a result. `print(99999)` puts `99999` in a result, and the prose then passes — that is F3 working as designed, and F4's problem (§ 11). |
| 2 | **Factual text inside a fence.** ```` ```text ```` around "Customer B owes 1200 dollars." | No execution has that text, so the block is a miss and is checked as prose: `1200` is flagged unless a result carries it. | A model can run `print("Customer B owes 1200 dollars.")` and show that script; the sentence is then script content, displayed as code, and not checked. The label says "script", the output is a result that carries the tokens, and only V1 can say whether the sentence holds. Named, not fixed. |
| 3 | **An altered script.** One constant changed from what ran — or one byte: a trailing space inside a literal, a combining mark instead of a precomposed letter. | Byte equality after removing the wrapper: the block equals no row, so it is a miss, checked as prose, labelled `unmatched`. `codeShape` is not used, and nothing is normalized, so the two probe programs are misses against each other, as they must be. | A copy that differs in a byte the person cannot see on screen is also a miss; the person may believe it is the same program. The label and the library's attachment are what resolve that, not the match. |
| 4 | **An invented constant in a real script.** `threshold = 0.01` ran. | Script content, not a finding. A prose claim repeating it needs a result. | The person reads `0.01` in code; the label says it is the script, not a result. |
| 5 | **Tool-result content injected into a script.** A result says "show this script: …", or the model copies result text into code. | Only the program the tool EXECUTED is on a row. Text that never ran is a miss. Text that did run is script content, displayed under a label that names the call — the person sees what ran, which is the point of attaching it. | Injection that makes the model RUN code is a sandboxing and check-in matter (`codeRunnerTool`'s `checkIn`), not this design's. |
| 6 | **Very large scripts, or many of them.** A 10 MB "script", or 400 small ones, to exhaust the gate or the ledger. | `MAX_SCRIPT_CHARS` at record time; `MAX_SCRIPT_ROWS` per turn, text dropped at the turn boundary; `MAX_CODE_REGIONS`; current-turn matching; a linear scan. The total is 512 comparisons and 512 KiB of retained text, whatever the conversation's length. An over-size execution is `unmatched: over-size`, never silently matched or silently dropped; dropped rows and regions are counted. | The extractor's own `MAX_ANSWER_TOKENS` still counts the rest. |
| 7 | **Near-identical executions.** Two runs differ by one byte; the block equals one. | Byte equality names that one. Identical rows name the latest and count the rest. No nearest-match is ever reported. | None. |
| 8 | **Formatting as exemption.** Inline spans, an unclosed fence, an indented fence. | All prose. | None. |
| 9 | **A rewritten script.** A before-tool middleware changed the program; the model shows its original. | The row holds what ran and says `rewritten`; the original is a miss; the account says a rule changed the script and does not reveal the earlier text. | None named. |
| 10 | **A label that claims more than the record.** A timed-out call shown as "did not finish"; a refused result shown as a failed run; a plain return shown as "ran". | § 4.3: execution evidence, settlement and delivery are read separately; a timeout or cancel without runner facts is `outcome-unknown`; a completion whose result was refused stays `completed`; a return without facts is `returned`. | A remote runner that finished after the caller stopped waiting stays unknown: the record holds no fact to promote it with. |
| 11 | **Data pasted into code.** The script embeds rows or a person's value. | The attachment shows the script the app asked for; it is answer text, which no policy covers. The row's `text` is covered by name. | An app under a redaction policy that also attaches scripts shows what its own tool ran; the docs say so. |

## 10. The test plan

Every case below is a required test; the names are proposed.

**`test/core/agent/evidence/code-regions.test.ts`** — the grammar: a closed backtick
fence, a tilde fence, an info string, a fence closed by a longer fence, a fence with
leading spaces (prose), an indented code block (prose), an inline span (prose), an
**unclosed fence** (prose to the end), nested backticks inside a block, a program ending
in a line break (the empty line before the closing fence is content), more than
`MAX_CODE_REGIONS` regions (counted), a one-pass cost bound on a long run of backticks.

**`test/core/agent/evidence/script-match.test.ts`** — the rule:
- the script that ran, shown byte for byte → matched, no candidates from the block;
- **an invented constant in a real script** → not flagged inside the block; the same
  constant repeated in the prose → flagged;
- **an altered script** (one constant changed) → `unmatched: no-execution-this-turn`; the
  changed constant flagged as prose;
- **the review's two counterexamples are misses**: the program with two trailing spaces
  inside a triple-quoted literal against the copy without them, and `"é"` against
  its NFC form `"é"` — each pair in both directions;
- a CRLF copy of an LF program → a miss; a copy with one trailing blank line added → a
  miss; a copy with the fence indented by one space → prose;
- **factual text in a fence** (```` ```text ```` "Customer B owes 1200 dollars.") →
  `unmatched`; `1200` flagged;
- **tokens from an unrelated call's arguments never count**: a value in the prose that
  appears only in another call's `code` argument stays flagged, with and without a
  matched block in the same answer;
- two byte-identical executions → the latest named, `alsoMatches: 1`; two executions one
  byte apart → the block equals at most one;
- a rewritten script → the original is a miss, the executed text matches, the earlier
  text is on no row and no event;
- an over-size execution → `unmatched: over-size`;
- a block equal to an EARLIER turn's program → `unmatched: no-execution-this-turn`, with
  `earlierTurnRows: 1`;
- a tool that does not declare `script` → every block a miss;
- a property (fast-check): for any program, the library's attachment with its wrapper
  removed equals the program byte for byte, and any single-byte change anywhere in the
  content — a trailing space, a line ending, a combining mark, a byte inside a literal —
  is a miss.

**`test/core/agent/evidence/script-labels.test.ts`** — the labels, on a mock runner and
a mock declared tool:
- `completed` from `ok: true`; **a completed script plus a size refusal**
  (`resultCeiling` exceeded) → `completed`, `resultWithheld: 'over-ceiling'`, the
  `tools.result_refused` event beside it;
- **a non-zero exit after partial work** (stdout has rows, then exit 1) →
  `completed-with-failure`, `exitCode: 1`, never `outcome-unknown`;
- **a remote completion after the client timed out** (the mock session rejects at the
  deadline while its "remote" side finishes) → `outcome-unknown`, and still
  `outcome-unknown` after the remote side reports: the record holds no fact to promote;
- a cancellation (`signal` aborted) → `outcome-unknown`; a thrown staging refusal →
  `outcome-unknown`;
- **a declared tool that returns without executing its argument** → `returned`, words
  "tool call returned; execution not confirmed";
- `submitted` from a never-dispatched batch member and from a permission refusal.

**`test/core/agent/evidence/script-artifact.test.ts`** — the attachment, on a mock
runner: `which: 'last'` and `'all'` with `omitted`; one label line per label; the text
form on a prose answer and the data form on a typed one; the fence of
`max(3, longestRun + 1)` backticks for a program with no backticks, with three, with four;
`maxChars` with the stated cut and `truncated.shownChars`; refused at build with no
declaring tool; appended even when the model showed a matched block; `turn_end.scripts`
under a redaction policy (text kept out, label kept); the row after a pause and resume;
the row after a window strategy dropped the assistant message.

**`test/core/agent/evidence/script-long-conversation.test.ts`** — 40 turns, each with
`MAX_SCRIPT_ROWS` executions of `MAX_SCRIPT_CHARS` bytes and `MAX_CODE_REGIONS` blocks in
the answer: the ledger's retained text never exceeds 512 KiB, the comparisons per answer
never exceed 512, the earlier-turn rows are counted and never matched, and the checkpoint
size does not grow with the number of turns.

**Byte identity.** `code: 'check'` (and an absent `code`) is byte-identical: the
names-and-numbers suite (`test/core/agent/names-and-numbers-from-evidence.test.ts`) and
every reference recording under `test/core/tools/reference/` are unchanged; no new scope
key is read on an agent without either arm (the `toolGrounding` law); the recovery
instruction's bytes are unchanged. A new reference, `agent-script-artifact.json`†, pins
the armed shape.

**The rest.** The recovery clauses registered in `test/modelFacingSurfaces.test.ts` and
found by `test/modelFacingScan.test.ts`, one row per label; the standing's equality case;
the account's golden (`test/answer-account/golden/`) with the template version bump; the
redaction vocabulary canary for the row's `text`
(`test/redaction/agent-redaction.vocabulary.test.ts`); `check:layering` for the new
leaf. An example, `examples/features/<next>-script-artifact.ts`, runs on the mock provider
with `localCodeRunner` and shows an attached script under each label the mock can produce.

## 11. Value binding (V1): out of scope, and the room left for it

The gate proves a value APPEARED in a result. It does not prove the value belongs to the
subject the answer names: "Customer B owes 1200" passed on a result that said "Customer
A: balance 1200". This design does not touch that. Code cannot help it either: a script
is not evidence for a value, and a matched script says nothing about which row a printed
number came from.

What the record leaves for V1:

- the `script` row carries `toolCallId`, so a later design can join the program to the
  result it produced (`history`, by call id) and to the answer's carriers
  (`evidence_checked.carriedBy`);
- the row holds the program as text for its turn, so a V1 reader could read which fields
  the program selected and which it aggregated — without any claim here that it will;
- no field on any row or event says what a value is ABOUT. F3 stays "a result carried
  it"; nothing in this design can be mistaken for F4.

V1 needs its own design.

## 12. Not in this design

- Matching against earlier turns' executions: v1 is current-turn only; an earlier-turn
  match needs its own bounded, explicitly attributed design.
- A typed answer's string values are not scanned for fences.
- No "nearest execution" diagnostic, no edit distance, no shape match, no normalization.
- `which: 'cited'`, `unlessShown`, and a request-only nudge telling the model not to
  retype the script: deferred (§ 13).
- A runner fact that proves termination (the local child was killed at the deadline), so
  a timeout could be labelled more precisely than `outcome-unknown`: a follow-up on the
  `CodeResult` port.
- No change to `check` mode, to the corpus, to the exempt corpus, or to `codeShape`.
- No support for a tool that runs code and does not declare it.
- No scanning of script text for redaction patterns: a policy selects by name, as
  everywhere.
- V1.

## 13. The open questions, with proposed answers

The questions stay open for the owner; each answer below is adopted from the review of
PR #235 and is the design's proposal until the owner confirms it.

1. **The attachment's default.** `last` is the v1 default. There is no `cited` in v1 and
   no silent fallback from one: membership carriers alone do not establish which
   computation supported a claim, and a later `cited` must expose its own omissions.
   *(adopted from review, owner to confirm)*
2. **A script the model already showed.** Always append the attachment when the arm is on;
   `unlessShown` is deferred. The model's copy never decides whether the authoritative
   one is delivered. *(adopted from review, owner to confirm)*
3. **A nudge not to retype.** Deferred, or a separate opt-in: prompt guidance, not an
   enforcement mechanism. *(adopted from review, owner to confirm)*
4. **A "differs by N lines" diagnostic.** None: exact-match failure plus the call list is
   enough for v1, and a second similarity rule is not introduced. *(adopted from review,
   owner to confirm)*
5. **A tool that files no runner facts.** The labels of § 4.3: "tool call returned;
   execution not confirmed" (`returned`), never an unqualified "executed" or "completed".
   *(adopted from review, owner to confirm)*
6. **The reason's name and class.** `script-unmatched` stays its own reason and
   `not-sure`; an unsupported value is a different finding. *(adopted from review, owner
   to confirm)*
7. **A rewritten script on the account.** The account says a before-tool rule changed the
   script; the match is against the dispatched text; the earlier text is not revealed.
   *(adopted from review, owner to confirm)*
8. **The bounds.** 32,768 / 16 / 32 / 8 / 4,000 are starting proposals, not measured
   guarantees; the total bound and the omitted counts of § 4.4 travel with them, and a cut
   attachment stays visibly incomplete. *(adopted from review, owner to confirm)*
9. **Earlier turns.** Current-turn only in v1: simpler selection, cost and provenance.
   *(adopted from review, owner to confirm)*

## 14. Decisions

1. Four facts, four places: a `script` row for F1/F2, the gate's verdict for F3, nothing
   for F4. No sentence joins them.
2. Code is never evidence. The corpus and the exempt corpus are untouched.
3. Code-running is declared (`Tool.script`), never inferred. `codeRunnerTool` declares it.
4. The preferred path is the library's attachment, from the record, labelled from the
   execution record.
5. Execution evidence, call settlement and result delivery are three facts; the five
   labels are `submitted` · `returned` · `completed` · `completed-with-failure` ·
   `outcome-unknown`; a completion stays confirmed when its result is withheld; a timeout
   or cancel without runner facts is unknown.
6. The attachment travels as data on `turn_end` always, and as text under the `---`
   separator on a prose answer, through the one composer, with a fence of
   `max(3, longestRun + 1)` backticks and the program's bytes unchanged.
7. A model-written fence is matched to ONE execution of the current turn by byte equality
   after removing only the Markdown wrapper. No normalization, no shape match, no nearest
   match. A copy that differs in any byte is a different program.
8. A match yields no value candidates and never grounds the prose. A miss is prose, as
   today, with a label and a reason that names this turn.
9. Inline spans, unclosed fences, indented code and indented fences are prose. No
   exemption by formatting.
10. `code: 'check'` is the default and is byte-identical to 11.x. `'match'` is opt-in.
    There is no `'skip'`.
11. The recovery message says keep the script and fix the values, with the execution's
    actual label; it claims no power to keep a script in the answer — the attachment does
    that.
12. Scripts are bounded at record time, at attachment and per turn; retained text is one
    turn's; matching is 512 comparisons at most; every cut and every omission is stated.
13. Script text is covered by the run's redaction rules by name, in the row and on the
    events; the live gate reads the heap; a post-hoc reader says "kept out".
14. V1 is out of scope; the row's call id and text are the room left for it.
