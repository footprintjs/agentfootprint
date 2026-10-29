# Code in an answer — the script artifact

**Design for review. Not approved to implement.** Nothing in this page is built.
Approval to review it is not approval to implement it. Written 2026-10-28 from the
revised H1 requirement, which folds in two rounds of review. It extends the evidence
gate ([src/core/agent/evidence/](../../src/core/agent/evidence/README.md)) and the
answer layer ([src/core/agent/assessment/](../../src/core/agent/assessment/README.md));
it is not a second check. The build follows in its own PR, after review.

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
     matched, byte for byte after a small stated normalization, against ONE recorded
     execution of a declared code-running tool. A match makes the block script content:
     no value candidates, labelled with that execution's outcome. A miss leaves the block
     prose, checked as today, labelled as not a recorded execution.
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

### 1.3 The direction

A displayed script is a claim about ONE execution: "this is what I submitted to the code
tool, and it ran". The record holds that execution — its `code` argument, its call id,
whether it finished. So the check is identity against the record, not evidence for
values. And where the app requires the script, the library should put it there from the
record, so the model has nothing to retype.

## 2. What exists, and what this design builds on

| Today | Where | What this design does with it |
|---|---|---|
| The code-running tool | `core/codeRunnerTool.ts` · `codeRunnerTool`: one `code` string argument, the port `provider-contract/types.ts` · `CodeRunner` / `CodeSession` / `CodeResult` | Declares itself code-running (§ 4.1). Unchanged otherwise. |
| The execution facts | `codeRunnerTool.ts` · `CodeRunFacts` (`ok`, `truncated`, `outputChars`, `shapeHash`, never the code), taken by the dispatch loop (`core/agent/stages/toolCalls.ts`, where `codeRunsOf` is read) and emitted as `agentfootprint.tools.code_run` (`events/payloads.ts` · `ToolsCodeRunPayload`) | The outcome label is read from these facts (§ 4.3). The code stays off the event. |
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
| F1 | The displayed script is the one submitted | the block equals, after § 5.2's normalization, the `code` argument of ONE recorded call of a declared code-running tool | "This is the script submitted." | that it ran; any value |
| F2 | That script ran | that call's execution record: it was dispatched, the tool returned, and the code-run facts say `ok` (§ 4.3) | "This script ran." | what it printed; any value |
| F3 | A tool returned this value | a `role: 'tool'` result carries the value — the corpus as today | "The tool returned this value." | that the value is about the claimed subject |
| F4 | The factual claim | V1: the value matches the subject, field, time and coverage asked about | the claim | — |

How they stay separate:

- **In the record.** F1 and F2 are facts about an EXECUTION, on one row per execution
  (`script`† row, § 6). F3 is the gate's verdict (`unsupportedValues`, `evidence_checked`)
  and is computed from `role: 'tool'` results only. Nothing from an F1/F2 row enters the
  evidence corpus or the exempt corpus. F4 has no row; § 11.
- **In the answer account.** F1 and F2 are one line per shown or attached script, vouched
  by the library (the match) and the tool (the outcome). F3 keeps today's evidence lines.
  No sentence joins them: "the script shown ran" and "the values were read from results"
  stay two sentences.
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
  counted. `'cited'` — the executions whose results the answer's values were read from
  (`evidence_checked.carriedBy`) — is an open question (§ 13), because that list is absent
  when the index hit its ceiling.
- `maxChars` (default 4,000, the same number as `codeRunnerTool`'s `DEFAULT_MAX_OUTPUT_CHARS`)
  bounds the text shown; a cut is stated, never silent (§ 4.4).
- Refused at build when no registered tool declares `script`: an arm that could never
  attach anything is a misconfiguration, not a no-op.

### 4.2 Where the script is attached

Two forms, like the limits block (`.limitsTravelWithTheAnswer()`): data always, text on
a prose answer.

**As data.** `turn_end` gains `scripts`† (present only under the arm):

```ts
readonly scripts?: readonly {
  readonly toolCallId: string;
  readonly tool: string;            // the name the model called
  readonly language?: string;       // as declared
  readonly label: 'executed' | 'did-not-finish' | 'submitted';
  readonly chars: number;           // of the whole script
  readonly lines: number;
  readonly truncated?: { readonly shownChars: number };
  readonly text: string;            // the script, cut at maxChars
}[];
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

Script run_code executed (call c1), attached by the library from the run record:

```python
import json, os
rows = json.load(open(json.loads(os.environ['AF_STAGED_INPUTS'])['dataset']))
print(f"{sum(r['amount'] for r in rows):.2f}")
```
````

The fence is one backtick longer than the longest backtick run inside the script (the
CommonMark closing rule), so a script that contains ```` ``` ```` cannot close the
library's block early. The label line is library-authored and past-tense, like the limits
heading, and it names the call, never a destination. A typed answer (`.outputSchema()`)
gets the data only; the answer is never edited — the same law as the standing line.

**Weighed.**

| Concern | Text appended | Typed attachment |
|---|---|---|
| What the person sees | the script, in the chat, with its label — no host work | only what the host renders |
| Memory | `captureTurnPayload` persists the composed answer as the assistant turn (`newMessages`), so the script is in memory and in every later turn's context. The app asked for it; the bound is `maxChars`. The standing line's rule holds: memory keeps exactly what was delivered. | nothing in memory beyond what the model wrote |
| Streaming | nothing appended is streamed: `prepareFinal.ts` · `captureTurnPayload` releases one `stream.token` only for a validated or policy-released answer, and the composed section is not part of the streamed draft. The script arrives with the returned string and `turn_end`. | the same event |
| The answer account | the account finds the block by rebuilding it from the record (the standing line's rule: `answer-account/account.ts` reads the line through `standingLineOf`, never by matching words) | read from `turn_end.scripts` |

Decision: both, as the limits block does. The text form is what makes "always show the
script" true without the model's cooperation; the data form is what a host with its own
renderer wants.

### 4.3 The labels

Read from the execution record of the matched or attached call, never from the model's
words:

| Label | The record says |
|---|---|
| `executed` | the call was dispatched, the tool returned a result, and — for a tool that files code-run facts (`codeRunnerTool`) — `ok: true`. For a declared code-running tool that files no facts, a completed call without error. |
| `did-not-finish` | `ok: false` (a non-zero exit — `codeRunnerTool` renders `[exit N]`), or the call ended in an error (`stream.tool_end` with `error`: the tool threw, timed out, or was aborted), or the result was refused over its ceiling (`tools.result_refused`). |
| `submitted` | the `code` argument is on the record and no outcome is: the call was never dispatched (`LLMMessage.notDispatched`, the batch settlement), refused before `execute` (`toolResultOrigin: 'not-entered'`, a permission or middleware refusal), or still open (`'input-cancelled'`, `'outcome-unknown'`). |

"Timed out" is `did-not-finish`: an attempt that ended at the deadline is not an attempt
that ran to the end. "Submitted" never means "did not run" — it means the record does not
show whether it did. A reader must not promote `submitted` to either neighbour.

### 4.4 Bounds, and the run's redaction rules

- **Per script.** `MAX_SCRIPT_CHARS`† (32,768) at RECORD time: an execution whose program
  is longer keeps a row with `chars` and `lines` and no text. It can be neither matched
  (§ 5.3, `over-size`) nor attached; the attachment says "the script (N characters) is
  over the bound and is not shown". A data script is a few kilobytes; a 100 KB "script"
  is a pasted table.
- **Per turn.** `MAX_SCRIPT_ROWS`† (16) executions keep a row; the rest are counted
  (`scriptsDropped`† on the turn's rows) and are unmatchable.
- **Attached text.** `maxChars` (4,000 by default): the first `maxChars` characters, then
  `[truncated: showing N of M characters]` — the `codeRunnerTool.ts` · `clip` sentence.
- **Redaction.** A policy selects by NAME. The script text travels under names the
  vocabulary already selects — `args` on the stream events, `toolCalls[].args` inside
  `history`, `llmLatestToolCalls`, `pausedToolArgs` — and under one new one, the
  `script`† row's `text` field, which `redaction/conversation.ts` · `conversationRedaction`
  gains. In the run, the gate reads the live heap, which no policy covers, so matching
  works under any policy. After the run, a reader of a record under a policy finds the
  placeholder: the account says the script is KEPT OUT (law 11 of
  `answer-account/README.md`), never "no script ran". The attached text rides the answer
  `run()` returns, which no policy covers either; the event copies (`turn_end.finalContent`,
  `turn_end.scripts[].text`) are kept out as the answer is.
- **Exporters.** `agentfootprint.tools.code_run` carries no code and keeps carrying none;
  the OTel adapter withholds a code runner's arguments (`adapters/observability/otel.ts`,
  its `captureToolContent` rule). The attachment reaches an exporter only as answer text,
  which the app chose to show.

## 5. Model-written fenced blocks

### 5.1 Code regions

Under `code: 'match'`†, a prose answer is scanned once, line by line, for fenced code
blocks by the CommonMark rules, and nothing else:

- An opening fence is a line of three or more backticks, or three or more tildes,
  indented at most three spaces, followed by an optional info string. A backtick fence's
  info string may not contain a backtick.
- The closing fence uses the same character, is at least as long, is indented at most
  three spaces, and carries nothing else but spaces.
- The region is the lines between them. Up to the opening fence's indentation is removed
  from each line (CommonMark).
- A fence that never closes is NOT a region: the text from it to the end is prose.
- An inline span (`` `240 ms` ``) is prose. An indented code block (four spaces) is prose.
  A fence indented four or more spaces (inside a list item) is prose.
- At most `MAX_CODE_REGIONS`† (32) regions are read; the rest are prose and counted.

The scan is linear in the answer (`lib/linearText.ts`'s law; pinned the way
`test/security/linear-scanners.test.ts` pins the shape reducer's scans). It lives in a
new leaf, `core/agent/evidence/codeRegions.ts`†, with no imports from the gate.

A typed answer (`.outputSchema()`) is not scanned in this version: its string values are
read as today (§ 12).

### 5.2 The match rule

A region is matched against the `script`† rows of this run (this turn's first, then
earlier turns' still readable). Both sides pass through one normalization, N, and are
then compared for exact equality:

1. line endings `\r\n` and `\r` become `\n`;
2. trailing spaces and tabs on each line are removed;
3. leading and trailing blank lines are removed;
4. the text is Unicode NFC.

Nothing else. No case folding, no collapsing of spaces inside a line, no change of
indentation, no stripping of comments or blank lines inside the script, no `codeShape`,
no edit distance. The info string is not compared with the declared language. A block
equal to one row after N is a match. A block equal to no row is a miss. `tokenize` and
`normalizeToken` (`lib/normalize.ts`) play no part: this is identity of a program, not
spelling of a value.

The row's text is the program the tool EXECUTED. `toolCalls.ts` files the row at the one
execute boundary (the `declareCoverage` precedent) from the arguments handed to
`tool.execute`, after any before-tool middleware. When a middleware rewrote the script,
the row says `rewritten: true`, and the model's original (still in `history`) is not a
match: it did not run.

Why this strict: every relaxation is a window an altered script fits through. The
normalization exists only for the four ways a faithful copy can differ by transport, and
each is reversible by the reader.

### 5.3 What a match yields, and what a miss yields

**A match.** The region is script content. It is removed from the text the extractor
reads, so it yields no value candidates, and `evidence_checked.scripts`† lists it:

```ts
{ block: 2, label: 'executed', toolCallId: 'c1', tool: 'run_code', turn: 'this' }
```

The corpus is untouched: a value in the prose that also sits in the script still needs a
result. Constants in a matched script are script content, never findings. A format
specification inside a matched block is covered by this rule, so no special case for the
`{x:.2f}` shape exists anywhere, in any mode — the original field spec's "known to the
extractor in every mode" would have changed `check` mode's bytes.

**A miss.** The region stays in the text and is checked as prose, exactly as today, and
it is labelled:

```ts
{ block: 2, label: 'unmatched', reason: 'no-execution' }   // no row equals it
{ block: 2, label: 'unmatched', reason: 'differs' }        // never filed: see below
{ block: 2, label: 'unmatched', reason: 'over-size' }      // a row with no text
{ block: 2, label: 'unmatched', reason: 'kept-out' }       // after the run, a redacted row
```

`differs` is listed to say it is refused: the library never reports "nearest execution",
because naming one would be a near match by another name (§ 13 asks whether a diagnostic
line count is worth it). Each `unsupported` value gains `region: 'prose' | 'code'`†
(`'code'` when every occurrence of the value is inside unmatched regions), present only
under `code: 'match'`.

**Two executions alike.** Two rows identical after N (the model re-ran the same script):
the block is the script of each; the verdict names the latest one of this turn (the
newest call id) and counts the rest (`alsoMatches: 1`), and the label is the named
execution's. Two rows that differ by anything after N are two executions, and a block
equals at most one of them. There is no "near-identical": a block that matches neither
is a miss.

### 5.4 Where the match runs

Inside the one judge closure in `route.ts` · `judgeEvidence`, before `checkAnswer` reads
the text: the regions are found, matched against the rows, the matched ones cut out of
the text, and the verdict carries `scripts`. Answer validation's `'names-and-numbers'`
row asks the same closure, so the delivered candidate is read the same way as the draft.
The contingent check (`core/agent/findings/contingent.ts`) reads `verdict.grounded`,
which a matched block never adds to.

## 6. The option, the record, the standing, the account

### 6.1 The option

```ts
// core/agent/evidence/types.ts · NamesAndNumbersOptions (proposed)
readonly code?: 'check' | 'match';
```

| mode | behaviour |
|---|---|
| `'check'` (default) | today's: the whole answer is prose. Byte-identical to 11.x — the verdict, the events, the recovery message, every reference under `test/core/tools/reference/`. |
| `'match'` | § 5: fenced regions matched against recorded executions; matched ones are script content; the rest prose. |

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
  readonly text?: string;                   // absent over MAX_SCRIPT_CHARS
  readonly outcome: 'executed' | 'did-not-finish' | 'submitted';
  readonly rewritten?: true;                // a before-tool middleware changed it
  readonly turn: number;
  readonly iteration: number;
}
```

The outcome is written when the call settles (the five `tool_end`-emitting paths and the
batch settlement, `core/agent/stages/README.md`); a row that never settles stays
`submitted`. The row crosses a pause: the ledger is in the checkpoint. The row survives a
window strategy: compaction never touches the ledger, which is why the text is on the
row and not read back from `history`.

**The verdict and the event.** `EvidenceVerdict` and `agentfootprint.agent.evidence_checked`
gain `scripts`† (§ 5.3) and `unsupported[].region`†, present only under `code: 'match'`.
Never the code text on the event.

**The attachment.** `turn_end.scripts`† (§ 4.2), present only under the arm.

**The standing.** One reason joins the closed table `reasons.ts` · `REASONS`:

| Reason | Layer | Class | Read from |
|---|---|---|---|
| `script-unmatched`† | 4 | not-sure | `findingsLedger`: a `script-shown`† witness row of this turn with `label: 'unmatched'` — filed by the Route decider while the answer layer is armed, as `grounded` and `steps-unfinished` are (`core/agent/assessment/witness.ts`) |

`checked` gains `script-match`† (layer 4): `of` = regions found, `ran` = regions matched
or missed (every region reaches a verdict). A matched region fires nothing and supports
nothing. The line's words (`compose.ts` · `REASON_WORDS`): "a script shown in the answer
matches no execution on the record"; the check's word (`CHECK_WORDS`): "scripts shown".
`STANDING_LINE_VERSION` is bumped. The equality law holds: the in-run standing equals
`assessAnswer()` over the same rows (`test/core/agent/assessment/answer-layer-equality.test.ts`
gains the case).

**The answer account.** The "How sure" row (`facts/howSure.ts`) gains, beside the
evidence lines, one line per shown or attached script, from the templates table with a
version bump (`answer-account/templates.ts`):

- "The script shown is the one `run_code` executed (call c1)." — voucher `tool:run_code`
  for the outcome, `library` for the match; the sentence takes the weaker, `library`.
- "The script shown did not finish (call c1, exit 1)."
- "A script shown matches no execution on the record; its 3 values were checked as prose."
- "The script under the answer was attached by the library from the record of `run_code`'s
  call c1 (executed, 412 characters)."

"Show me" (`answer-account/shown.ts` · `SHOW_ME_ALLOW_LIST`) points at the row's label,
outcome and counts; the `text` is a tool argument and stays on the deny list.

**The standing line.** Unchanged when nothing fires. When the only reason is
`script-unmatched`:

> Not sure — a script shown in the answer matches no execution on the record.

## 7. The recovery message

Under `guard` and `rails`, `buildEvidenceRecovery` composes one request-only instruction.
Under `code: 'match'` it gains one clause, after "Recovery action: replace the rejected
draft", chosen by what the verdict holds:

- **An unmatched region whose values were flagged:**
  > The fenced code in the rejected draft matched no recorded execution of `run_code`,
  > so its contents were checked as prose. Keep a script in the answer: show the program
  > exactly as it was submitted on that call, or say that the code shown is not the one
  > that ran. Fix the values in the prose. Removing the script does not satisfy this
  > check.
- **A matched region, with values flagged in the prose:**
  > The script shown was the one `run_code` executed and was not checked. Keep it. The
  > listed values were in the prose around it.

The values are listed as today, each with its `region`. The clause is a library sentence
about a finished call, in the past tense, and names no tool as where to go next
(`core/agent/README.md`, the correction law). It is registered in
`test/modelFacingSurfaces.test.ts`, like every model-facing composer. "Removing the
script does not satisfy this check" is true: a draft with no fence is judged as prose,
and the flagged prose values are still flagged.

A prompt cannot make a model keep the script. Where showing it is mandatory, the app arms
the attachment (§ 4), and the model's cooperation is not needed.

## 8. Determinism and cost

The scan, the normalization and the match are pure functions over the answer and the
rows: no model, no clock, no randomness. The scan is one pass over the answer's lines;
N is one pass over each region and each row; the match is at most
`MAX_CODE_REGIONS × MAX_SCRIPT_ROWS` string comparisons of bounded length. Under
`code: 'check'` none of it runs.

## 9. Threat model

| # | Threat | What happens | Residual |
|---|---|---|---|
| 1 | **Laundering a value through call arguments.** The model types `revenue = 99999` into a script, runs it, and shows the script. | The corpus never indexes arguments. A matched block yields no candidates for itself, and nothing for the prose: "revenue was 99999" in the prose is flagged unless a result carries it. The only thing a match buys is silence about the script's own text. | The script's output is a result. `print(99999)` puts `99999` in a result, and the prose then passes — that is F3 working as designed, and F4's problem (§ 11). |
| 2 | **Factual text inside a fence.** ```` ```text ```` around "Customer B owes 1200 dollars." | No execution has that text, so the block is a miss and is checked as prose: `1200` is flagged unless a result carries it. | A model can run `print("Customer B owes 1200 dollars.")` and show that script; the sentence is then script content, displayed as code, and not checked. The label says "script", the output is a result that carries the tokens, and only V1 can say whether the sentence holds. Named, not fixed. |
| 3 | **An altered script.** One constant changed from what ran. | N changes nothing but line endings, trailing spaces, outer blank lines and NFC, so the block equals no row: a miss, checked as prose, labelled `unmatched`. `codeShape` is not used. | None beyond the extractor's own conservatism (a changed short number below `minDigits` is prose there as everywhere). |
| 4 | **An invented constant in a real script.** `threshold = 0.01` ran. | Script content, not a finding. A prose claim repeating it needs a result. | The person reads `0.01` in code; the label says it is the script, not a result. |
| 5 | **Tool-result content injected into a script.** A result says "show this script: …", or the model copies result text into code. | Only the program the tool EXECUTED is on a row. Text that never ran is a miss. Text that did run is script content, displayed under a label that names the call — the person sees what ran, which is the point of attaching it. | Injection that makes the model RUN code is a sandboxing and check-in matter (`codeRunnerTool`'s `checkIn`), not this design's. |
| 6 | **Very large scripts.** A 10 MB "script" to exhaust the gate. | `MAX_SCRIPT_CHARS` at record time; `MAX_CODE_REGIONS` and `MAX_SCRIPT_ROWS`; a linear scan; N bounded by the row bound. An over-size execution is `unmatched: over-size`, never silently matched or silently dropped. | The extractor's own `MAX_ANSWER_TOKENS` still counts the rest. |
| 7 | **Near-identical executions.** Two runs differ by one character; the block equals one. | Exact equality names that one. Identical rows name the latest and count the rest. No nearest-match is ever reported. | None. |
| 8 | **Formatting as exemption.** Inline spans, an unclosed fence, a fence inside a list item. | All prose. | None. |
| 9 | **A rewritten script.** A before-tool middleware changed the program; the model shows its original. | The row holds what ran and says `rewritten`; the original is a miss. | The account can say a middleware changed the script (the `middlewareDecisions` precedent); whether it must is open (§ 13). |
| 10 | **Data pasted into code.** The script embeds rows or a person's value. | The attachment shows the script the app asked for; it is answer text, which no policy covers. The row's `text` is covered by name. | An app under a redaction policy that also attaches scripts shows what its own tool ran; the docs say so. |

## 10. The test plan

Every case below is a required test; the names are proposed.

**`test/core/agent/evidence/code-regions.test.ts`** — the grammar: a closed backtick
fence, a tilde fence, an info string, a fence closed by a longer fence, a fence inside a
list item (prose), an indented code block (prose), an inline span (prose), an **unclosed
fence** (prose to the end), nested backticks inside a block, more than
`MAX_CODE_REGIONS` regions (counted), a one-pass cost bound on a long run of backticks.

**`test/core/agent/evidence/script-match.test.ts`** — the rule:
- the script that ran, shown verbatim → `executed`, no candidates from the block;
- **an invented constant in a real script** → not flagged inside the block; the same
  constant repeated in the prose → flagged;
- **an altered script** (one constant changed) → `unmatched: no-execution`; the changed
  constant flagged as prose;
- **factual text in a fence** (```` ```text ```` "Customer B owes 1200 dollars.") →
  `unmatched`; `1200` flagged;
- **tokens from an unrelated call's arguments never count**: a value in the prose that
  appears only in another call's `code` argument stays flagged, with and without a
  matched block in the same answer;
- the four normalizations, each alone, still match; a fifth difference (a space inside a
  line, a changed case, a stripped comment) does not;
- two identical executions → the latest named, `alsoMatches: 1`; two executions one
  character apart → the block equals at most one;
- a rewritten script → the original is a miss, the executed text matches;
- an over-size execution → `unmatched: over-size`;
- `did-not-finish` from a non-zero exit, from a thrown error, from a timeout; `submitted`
  from a never-dispatched batch member and a permission refusal;
- a tool that does not declare `script` → every block a miss;
- a property (fast-check): for any program, N is idempotent, the program matches itself
  after each normalization, and any single change to a non-blank character inside a line
  breaks the match.

**`test/core/agent/evidence/script-artifact.test.ts`** — the attachment, on a mock
runner: `which: 'last'` and `'all'`; the three labels; the text form on a prose answer
and the data form on a typed one; the fence longer than the script's longest backtick run;
`maxChars` with the stated cut; refused at build with no declaring tool; `turn_end.scripts`
under a redaction policy (text kept out, label kept); the row after a pause and resume;
the row after a window strategy dropped the assistant message.

**Byte identity.** `code: 'check'` (and an absent `code`) is byte-identical: the
names-and-numbers suite (`test/core/agent/names-and-numbers-from-evidence.test.ts`) and
every reference recording under `test/core/tools/reference/` are unchanged; no new scope
key is read on an agent without either arm (the `toolGrounding` law); the recovery
instruction's bytes are unchanged. A new reference, `agent-script-artifact.json`†, pins
the armed shape.

**The rest.** The recovery clause registered in `test/modelFacingSurfaces.test.ts` and
found by `test/modelFacingScan.test.ts`; the standing's equality case; the account's
golden (`test/answer-account/golden/`) with the template version bump; the redaction
vocabulary canary for the row's `text` (`test/redaction/agent-redaction.vocabulary.test.ts`);
`check:layering` for the new leaf. An example, `examples/features/<next>-script-artifact.ts`,
runs on the mock provider with `localCodeRunner` and shows an attached script with each
label.

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
- the row holds the program as text, so a V1 reader could read which fields the program
  selected and which it aggregated — without any claim here that it will;
- no field on any row or event says what a value is ABOUT. F3 stays "a result carried
  it"; nothing in this design can be mistaken for F4.

V1 needs its own design.

## 12. Not in this design

- A typed answer's string values are not scanned for fences.
- No "nearest execution" diagnostic, no edit distance, no shape match.
- No nudge telling the model not to retype the script (§ 13).
- No change to `check` mode, to the corpus, to the exempt corpus, or to `codeShape`.
- No support for a tool that runs code and does not declare it.
- No scanning of script text for redaction patterns: a policy selects by name, as
  everywhere.
- V1.

## 13. Open questions

For the owner and Codex:

1. **`which: 'cited'`.** Should the default attachment be the executions whose results the
   answer's values were read from (`carriedBy`), falling back to `'last'` when that list
   is absent? It ties F2 to F3 by call id without claiming F4. The cost is a default that
   depends on the index not having hit its ceiling.
2. **A second attachment of a script the model already showed.** When a matched block is
   in the answer, should the arm still append the same script under the separator? The
   design says yes (the app asked, and the library never edits the reply). An
   `unlessShown: true` option would skip it on a match.
3. **A request-only nudge** ("the script you run is attached by the library; do not
   repeat it"), opt-in like `nudge`, composed from the declaration only. It changes the
   request's bytes, so it must be its own switch.
4. **`differs` as a diagnostic.** Never a match — but should an unmatched block report "N
   lines differ from the latest execution" so a person can see the alteration? It names a
   nearest execution, which § 5.3 refuses on the verdict; it could live on the account
   only.
5. **`executed` for a tool that files no code-run facts.** A declared code runner that is
   not `codeRunnerTool` completes a call; the library knows no exit status. Is "executed"
   the right word, or should such a tool get `completed`, a fourth label?
6. **The reason's name and class.** `script-unmatched` is `not-sure`. Should a shown
   script that matches no execution instead be a reason of its own class, or fold into
   `value-unsupported` when its values are also flagged?
7. **The rewritten case on the account.** Must the account say a before-tool middleware
   changed the program, as it says a ruled argument was rewritten?
8. **Bounds.** `MAX_SCRIPT_CHARS` 32,768, `MAX_SCRIPT_ROWS` 16, `MAX_CODE_REGIONS` 32,
   `MAX_ATTACHED_SCRIPTS` 8, `maxChars` 4,000 — the numbers are proposals.
9. **Earlier turns.** Matching reaches rows of earlier turns (labelled `turn: 'earlier'`).
   Should v1 match this turn's rows only?

## 14. Decisions

1. Four facts, four places: a `script` row for F1/F2, the gate's verdict for F3, nothing
   for F4. No sentence joins them.
2. Code is never evidence. The corpus and the exempt corpus are untouched.
3. Code-running is declared (`Tool.script`), never inferred. `codeRunnerTool` declares it.
4. The preferred path is the library's attachment, from the record, labelled from the
   execution record: `executed` · `did-not-finish` · `submitted`.
5. The attachment travels as data on `turn_end` always, and as text under the `---`
   separator on a prose answer, through the one composer.
6. A model-written fence is matched to ONE execution by exact equality after four stated
   normalizations. No shape match, no nearest match.
7. A match yields no value candidates and never grounds the prose. A miss is prose, as
   today, with a label and a reason.
8. Inline spans, unclosed fences and indented code are prose. No exemption by formatting.
9. `code: 'check'` is the default and is byte-identical to 11.x. `'match'` is opt-in.
   There is no `'skip'`.
10. The recovery message says keep the script, fix the values, and that removing the
    script does not satisfy the check.
11. Scripts are bounded at record time, at attachment, and per turn; a cut is stated.
12. Script text is covered by the run's redaction rules by name, in the row and on the
    events; the live gate reads the heap; a post-hoc reader says "kept out".
13. V1 is out of scope; the row's call id and text are the room left for it.
