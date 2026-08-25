# unsupported-argument — acted on a value nothing served

**Why.** On the second turn of a recorded triage conversation, the window dropped the user message
carrying the true machine id and kept the assistant's own rendered answer from turn one. Asked "what
is the backup status for that machine?", the model resolved the reference out of its OWN prior prose,
took a truncated job-name fragment (`bkp-4417-ganymede-tier2` → `4417-ganymede`) for a machine name,
called the backup tool with it, got an honest "nothing found", and told the person their
actually-protected machine had no backup record.

Every shipped rail passed, and passed honestly. The coverage envelope was complete, the absence
envelope was truthful, and the evidence gate agreed — every value in the answer really was grounded
in a tool result, because the tool really did return "no record" for the string it was handed. The
defect was not a value. It was the **referent**, bound wrong at the argument, at the one seam in the
whole loop that had no check: the model's CHOICE of tool arguments.

**The rule.** After each LLM response, for every call to an **armed** tool — one whose author
declared `argumentsFrom` — every identifier-like string argument must appear in the frame the model
chose from: the system prompt, any USER message, or any TOOL-result message of the exact request this
call was assembled from. Case-insensitive substring. Detection only; nothing is blocked, delayed or
rewritten.

**Assistant messages are deliberately NOT ground.** The system prompt, the user's words and every
tool result are things the RUN put in front of the model. Its own earlier turns are things it wrote.
A value whose only source is the model's own rendered prose has been re-derived from a rendering
rather than read from evidence — and re-deriving is exactly how a truncated job name becomes a
machine name.

**One declaration, two seams.** `argumentsFrom` was added for
[`dangling-reference`](../dangling-reference/README.md), and it arms this check too, with no second
field to declare. Dangling-reference asks, at request assembly, whether the ground is still in reach
while the tool is OFFERED; this asks, after the response lands, whether the value the model chose
came from that ground when the tool was CALLED. A tool that declares nothing is never either check's
subject — the whole zero-delta story.

**The fences** (they are the check's honesty — each one has a test):

| Situation                                                    | Verdict                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Argument is a number, boolean, `null`                        | never checked — not identifier-shaped                            |
| Trimmed value is shorter than 4 characters                   | never checked — substring matching below that is noise           |
| Value appears in the system prompt, a user message, a result | no finding — it was served                                       |
| Value is declared in an `enum` in the tool's own inputSchema | no finding — declared vocabulary is served by the schema         |
| Value appears ONLY in an assistant message                   | finding: the only ground is the model's own earlier prose        |
| Value appears nowhere in the frame                           | finding, **different message**: nothing served it at all         |

The two findings say different things because they call for different fixes. Self-reference has a
real ground somewhere upstream and the fix is to re-fetch it (the message names the tool's declared
`argumentsFrom` tools by name). "Nowhere" has no ground in the window at all, and says so.

**Identity is per (tool, argument path).** A finding carries `predicate` = the argument's dot-path
(`machine`, `filter.hosts.0`), which `contextErrorIdentity` reads. Two bad arguments of one call are
two defects; the same argument path re-chosen on a later iteration is ONE finding, however many times
it recurs.

**Stated limits.**

- **Composite values file.** A value assembled from several grounds (`"host1,host2"`) fails the
  substring test and files a finding, because no single served string contains it. The declaration is
  the contract: `argumentsFrom` means this tool's arguments come from those tools' RESULTS. A tool
  whose arguments are legitimately composed by the model should not declare it.
- **Substring grounding is deliberately lenient.** A value inside ANY served string passes, even an
  unrelated one — a machine id that happens to appear in a different tool's result is accepted. This
  check catches **fabrication** and **self-reference**, not **misattribution**. A false accusation
  costs a reader's trust in every finding this family files, so the bias points the lenient way.
- **The enum fence is flat.** Values are collected from every `enum:` array anywhere in the tool's
  schema and matched at any argument path, not per-field. Best-effort, and lenient on purpose for the
  same reason.

**Where it runs.** `callLLM`, immediately after the response lands, beside the wire check — that seam
has everything the check needs and nothing it does not: the frame (`llmRequest`), the choices
(`response.toolCalls`), the arming (`deps.toolGrounding`) and the shared findings rail that dedups one
defect to one `integrity.context_error` per run.

**Runnable example.**

```ts
import { unsupportedArgumentsOf } from './check.js';

const findings = unsupportedArgumentsOf(
  [
    {
      toolName: 'backup_status',
      toolCallId: 'call-2',
      args: { machine: '4417-ganymede' },
      argumentsFrom: ['fleet_report'],
    },
  ],
  {
    grounded: ['You are a fleet triage assistant.', 'What is the backup status for that machine?'],
    assistant: ['The nightly job bkp-4417-ganymede-tier2 finished at 02:14.'],
  },
  2,
);
// → one 'unsupported-argument' at seam 'choice', predicate 'machine'. The
//   message says the only ground is the model's own earlier answer, and names
//   the honest fix: call fleet_report again. Nothing blocked the call.
```
