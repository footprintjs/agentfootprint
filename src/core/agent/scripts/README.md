**Mixed** — code in an answer: the program each call of a declared code-running tool submitted, what its execution record proves, whether a block the answer shows is that program, and the library's own copy under the answer.
Map: `types.ts` (the `script` row and the attachment's options; the shared vocabulary is `../../../lib/scriptRecord.ts`).
Fold: `label.ts` (the ONE label rule and the label's words), `rows.ts` (the one writer and the one reader of a turn's rows, and the bounds), `match.ts` (is a block ONE call's program?), `judge.ts` (the gate's judge with the match in front of it).
Lens: `attachment.ts` (what travels with the answer), `wrapper.ts` (the library's fence), `recovery.ts` (the revision request's one clause).

Design: [docs/design/2026-10-script-artifact.md](../../../../docs/design/2026-10-script-artifact.md).

# `scripts/` — code in an answer

**The law.** A displayed script is a claim about ONE call — "this is what I
submitted to the code tool". The record holds that call, so the check is
IDENTITY against the record, never evidence for a value: four facts stay
apart, and code is never evidence.

| # | Fact | Established by | Never supports |
|---|---|---|---|
| F1 | the displayed script is the one submitted | a fenced block equal, byte for byte after removing only the Markdown wrapper, to the program ONE call of THIS turn submitted (`match.ts`) | that it ran; any value |
| F2 | that script ran | the runner's facts for that call carrying an EXPLICIT exit code (`label.ts`) | what it printed; any value |
| F3 | a tool returned this value | a `role: 'tool'` result — the evidence gate, untouched | that the value is about the claimed subject |
| F4 | the claim holds | value binding (V1) — not built | — |

Nothing from a `script` row enters the evidence corpus or the exempt corpus. A
script that ran `print(99999)` proves it printed 99999, not that revenue was
99999 — no sentence here says "the script shows where the value came from".

```ts
import { Agent, codeRunnerTool } from 'agentfootprint';
import { localCodeRunner } from 'agentfootprint/providers';

const agent = Agent.create({ provider, model })
  .tool(codeRunnerTool({ runner: localCodeRunner() }))       // declares `script: { argument: 'code' }`
  .namesAndNumbersFromEvidence({ posture: 'guard', code: 'match' })
  .scriptTravelsWithTheAnswer({ which: 'last', maxBytes: 4000 })
  .build();

agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => {
  payload.scripts?.blocks; // [{ block: 1, label: 'completed', exitCode: 0, toolCallId: 'c1', tool: 'run_code' }]
});
agent.on('agentfootprint.agent.turn_end', ({ payload }) => {
  payload.scripts?.shown[0]?.label; // 'completed' — the attached program, from the record
});
```

The runnable example is `examples/features/121-script-artifact.ts`.

## Declared, never inferred

A tool is code-running because it says so: `Tool.script = { argument, language? }`
(`tools/script.ts`, judged at the three doors — `defineTool`, dispatch
`scriptOf`, MCP ingest). The library never reads it off a tool's name, a
property named `code` or a description; a tool that runs code without
declaring it has no submissions on the record, and a block shown for it is prose.

## The row — one per call, filed at the execute boundary

While `code: 'match'` or `.scriptTravelsWithTheAnswer()` is on, the dispatch
loop (`stages/toolCalls.ts` · `fileScript`) files one `script` row per call of a
declaring tool, through ONE writer (`rows.ts` · `recordScriptRow`):

- `text` is the program SUBMITTED to the tool — the arguments handed to
  `execute`, after any before-tool middleware; a rewrite says `rewritten: true`
  and the model's earlier text is on no row;
- the outcome is written where the call settles (every `tool_end` path and the
  batch settlement); a call that pauses files a `submitted` row WITHOUT its
  text first, and the settled row is the one that carries it (append only, last
  wins). A row that never settles stays `submitted`;
- `resultWithheld: 'over-ceiling'` when the tool's own ceiling replaced the
  delivered result — a withheld result never undoes a completed execution.

**The attestation rule: what a row says is bound to the exact dispatch it
describes.**

- **A row belongs to a dispatch, never to a provider id.** `dispatch` is the
  1-based order of the actual dispatch within its turn, set by the one writer.
  A later call that reuses a provider id is a new dispatch; a pause and the row
  that settles it share one (`AgentState.pausedScriptDispatch` carries it
  across the checkpoint). Rows are counted against `MAX_SCRIPT_ROWS`, read
  (`scriptRowsOfTurn`: the last row per dispatch, in execution order), matched,
  attached and looked up by the account by it.
- **The program is a value read at its boundary.** The proposal is read as the
  call arrives, before any rule runs; the submission just before `execute`
  (`rows.ts` · `programIn`). A string cannot be edited afterwards, so a tool
  that edits its own arguments after receiving them never rewrites the record.
  A call that pauses from inside `execute` carries both values across the
  checkpoint (`AgentState.pausedScriptPrograms`, named in the redaction
  vocabulary), because its resume does not run it again.
- **The runner's facts reach only the dispatch that ran.** Each dispatch puts
  its own slot on the call's execution context (`codeRunnerTool.ts` ·
  `CODE_RUN_SLOT`). The runner files its facts there and in the published
  `codeRunsOf(tool)` map, which is filled and emptied exactly as before. A row
  attests from the slot, never from the map: the map is keyed by the
  provider's id, and when two agents shared a tool it let one run's facts
  attest another run's script.

Why: a row is an attestation ("this program ran, and exited 7"). One read from
a live object, or a fact found by an id two calls share, can attach one call's
outcome to another call's program.

## The labels — execution evidence first, then settlement, never delivery

| Label | Words | The record says |
|---|---|---|
| `submitted` | submitted | the call never entered `execute` (not dispatched, refused, or still open). Never "did not run" |
| `returned` | tool call returned; execution not confirmed | the tool returned and no runner facts say how the program ended (none filed, or facts reporting no outcome) |
| `reported-success` | runner reported success; no exit code | `ok: true`, no exit code |
| `reported-failure` | runner reported failure; no exit code | `ok: false`, no exit code, no service error (a stopped process included) |
| `completed` | completed, exit 0 | an explicit `exitCode: 0` |
| `completed-with-failure` | completed with failure, exit N | an explicit non-zero exit code |
| `outcome-unknown` | outcome unknown | no facts after a timeout, a cancellation or a thrown error; or a service error with no exit code |

Only an explicit exit code proves the program reached an exit; `ok` is a
verdict and never prints an exit number. A reader must not promote a label to
its neighbour.

## The match (`code: 'match'`)

A prose answer is scanned once (`../evidence/codeRegions.ts`). A fence opened at
column 0 and closed is a region. Inline spans, indented code, indented fences and
unclosed fences are prose, so formatting alone exempts nothing.

**The reader rule: a block closes where a CommonMark renderer closes it, and
reading stops wherever a renderer could pair fences another way.** A block
closes at a run of its own fence character at least as long as its opening
fence, indented by up to three spaces and followed only by spaces. A line ends
at an LF, a CR or a CRLF.

Reading stops at the first of these lines; from there on nothing is read as a
block, and everything is prose:
- outside a block:
  - a fence indented by one to three spaces (a list item's fence, or an
    indented one);
  - a line that may start an HTML block;
  - a `$$` display-math line;
  - a byte-order mark at the start;
- inside a block:
  - a closing run followed by a tab (CommonMark versions disagree on it);
  - a run of the block's own fence character as long as its fence (a laxer
    renderer could close there). That block is prose too.

Why: a matched block is exempt from the check. If the reader saw a block where a
renderer shows prose, a model could submit a program that holds a sentence and
show it so that the sentence renders outside the block, unchecked:

````text
```python            ← the model's fence, three backticks
x = 1
  ```                ← CommonMark closes the block here
Revenue was 4321.    ← on screen: prose, so it is checked
```                  ← opens a new block that never closes
````

The library's own attachment can never trip this rule. Its fence is longer than
any run in the program, and the reader never scans it.

A region matches only when
its content equals a program a call of THIS TURN submitted, with nothing
normalized (no trailing-space strip, no line-ending rewrite, no Unicode
normalization, no shape match, no nearest match). A match is cut out of the text
the extractor reads and labelled with the call's outcome; a miss stays prose,
checked as today, labelled `unmatched` with a reason. Earlier turns are counted
(`earlierTurnRows`), never compared.

Under the answer layer each block files a `script-shown` witness row; an
unmatched one fires `script-unmatched` ("not sure"), and every block counts in
the `script-match` check. A matched block supports nothing.

## The attachment (`.scriptTravelsWithTheAnswer()`)

The preferred path: the library attaches the recorded program itself, labelled
from the execution record, so the model has nothing to retype. Data on
`turn_end.scripts` always; text after the `---` separator on a prose answer,
after the standing line and the limits block, in the library's own fence
(`max(3, longestRun + 1)` backticks, LF-terminated wrapper lines, the program's
bytes unchanged). A typed answer gets the data only. Attached even when the
model also showed a matched copy.

**The boundary rule: the attachment never renders inside a block the text
before it left open.** The composer hands the scripts block the exact text it
follows (`semantics/coverage/answer.ts` · `composeAnswerWithCoverage`), and the
block reads it like a renderer (`attachment.ts` · `attachmentBoundary`):

- a fence still open there (an answer that ends inside an unfinished fence) is
  closed first, with the same character and length, and the record says so
  (`turn_end.scripts.closedFence`);
- after a line where a renderer could pair fences another way (an indented
  fence, raw HTML, display math), the reader cannot tell what is open, so the
  programs stay out of the text: each script is its label line alone, and the
  data carries them (`turn_end.scripts.withheldFromText`).

Why: inside a model's unfinished fence, a fence line in the program closes the
model's block, and the rest of the program renders as prose, under the answer,
unchecked.

````text
The total is computed.

```text
unfinished output            ← the model never closed this
```                          ← the library closes it (closedFence)

Script submitted to `run_code` on call `c1` — completed, exit 0. Attached by the library from the run record:
````

**Every dynamic value in a library line is inert** (`inert.ts` ·
`inertCode`): a tool's name or a call id is one inline code span, its line
breaks and format characters written as `\u{…}`, its delimiter longer than any
backtick run inside. A provider may hand the library any string as a call id;
interpolated as it is, a blank line in an id would start a paragraph of its own.

## Bounds — one unit, UTF-8 payload bytes

`MAX_SCRIPT_BYTES` 32,768 per program at record time (a longer one keeps its
facts, no text: unmatchable, unattachable, counted); `MAX_SCRIPT_ROWS` 16
dispatches per turn keep a row, however the provider numbered them (the rest
counted in `AgentState.scriptsDropped`);
`MAX_CODE_REGIONS` 32 blocks read per answer; `MAX_ATTACHED_SCRIPTS` 8;
`maxBytes` 4,000 per attached program, cut at a code-point boundary and said.
A row's text lives for its own turn (seed drops it from earlier turns'
rows), so the eligible text is at most 512 KiB, and matching at most 512
comparisons per judged answer. Not bounded here: prior turns' metadata,
history, and the answers that carried an attached script.

## What it does not do

It does not say a value belongs to the subject the answer names (V1). A typed
answer's strings are not scanned. No nearest-submission diagnostic, no edit
distance, no shape match. No `which: 'cited'`. Deleting an unmatched block
removes its reason, so a draft without the script can pass the check — the
attachment, not a prompt sentence, is what keeps a script in the answer.
