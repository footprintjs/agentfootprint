# `coverage/` — an absence that names itself, and a limit that travels

Two result primitives, both **invented in field use** on a live triage agent
before this library had any answer for either. We copied them; the credit
belongs to the field.

| | says | door |
|---|---|---|
| `absent()` | "I looked HERE, and there is nothing" | tool result |
| `coverage()` | "my verdict covers THIS and not THAT" | tool result |

## 1. `absent()` — the direction of the error is the argument

A tool that finds nothing returns *something*: an empty array, a `null`, a
sentence. From any of those a model cannot tell **"I looked and there is
nothing"** from **"I could not look"**.

That confusion is not symmetric, which is why it is worth a primitive:

- a *nothing-found* misread as an *outage* sends an engineer to investigate a
  collector that is working perfectly — expensive, and self-correcting;
- an *outage* misread as *nothing-found* declares a system healthy that was
  **never checked** — cheap, silent, and wrong in the direction that hurts.

So an absence must not share a shape with an error. An error is a result with
`error: true`, a message, and no coverage. An absence carries three things a
`null` cannot:

1. **the coverage** — which sources, which window, which population;
2. **that a retry returns the same** — the loop this ends is a model re-asking
   the identical question because a mismatch looked like a fluke;
3. **a shape distinct from an error** — recognized by the framework, not by
   convention.

```ts
return absent({
  what: `FLOGI entries on ${port}`,
  checked: [`${sw}: the live fcns database`, 'window: the last 24h'],
  notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
  cannotCover: [{ what: 'ports on the peer fabric', why: 'this collector is scoped to one fabric' }],
  tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
});
```

## 2. `coverage()` — what a clean result does NOT rule out

"Everything looks fine" is produced from the checks that ran, and arrives with
no way to tell whether *fine* means **verified** or **unexamined**. A ledger is
three lists the tool knows and the model does not — and only the tool knows the
third, which is why this cannot be prompt engineering.

```ts
return coverage(verdict, {
  checked: ['SRDF pair state on all 4 arrays (live query)'],
  notChecked: [{ what: 'NDM migration sessions', why: 'the API timed out — ask again' }],
  cannotCover: [{ what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' }],
});
```

It is the sibling of the evidence gate (9.35.0): **the gate catches invented
VALUES, this catches unstated LIMITS.** Both are ways an answer can be false
while every token in it is real.

## What the framework does with them

Recognition is STRICT (the effects-envelope law): only a plain object carrying
the reserved `af_absent` / `af_coverage` key is one. Every other shape any tool
has ever returned takes the path it always took, byte for byte.

| | on an **absence** | on a **ledger** |
|---|---|---|
| delivered status | `'absent'` — the seventh `ToolResultStatus`, routable by `onToolStatus` | unchanged |
| event | `agentfootprint.tools.absent` | `agentfootprint.tools.coverage_declared` |
| tracked state | appended to `coverageDeclared` | appended to `coverageDeclared` |
| evidence corpus | grounds its **coverage only** | indexed as ordinary data |
| final answer | folds into the block, with `.limitsTravelWithTheAnswer()` | same |

### What deliberately does NOT change

- **Nothing retries it.** No reliability rule, no re-ask, no loop. An absence
  that read as a failure to a retry policy would loop exactly where it must not.
- **Nothing fails.** `error: true` is never set, the after-tool chain runs as
  normal, and the step pointer advances — the call ran and answered.
- **The gate does not flag it.** An absence is not an unsupported value.
- **The ceiling still measures it**, and coverage is declared BEFORE the
  measurement, so a limit does not die with an oversized payload (the same law
  the effects channel already has).

### The one sharp edge: laundering

The evidence corpus is every `role: 'tool'` result. An absence's job is to say
what was looked FOR — which in practice quotes the arguments the model passed.
Indexed whole, an invented identifier would become **grounded** by the one
operation that proves nothing about it: a lookup that found nothing. So an
absence grounds `checked` / `not_checked` / `cannot_cover` and nothing else
(`evidence.ts`). It is `evidence/frames.ts`'s argument on the tool side of the
conversation.

If the user named the value, it is exempt anyway. Only a value appearing for
the first time inside an absence loses grounding — the case where it was never
evidence to begin with.

**What that does not close.** The whitelist rests on "coverage is the tool's own
words about the world". An author who string-interpolates an unvalidated
argument into a `checked` line puts a model-supplied token back into the corpus
through the one list the whitelist admits, and no library can tell which
characters of a sentence a tool composed and which it copied. Interpolate
identifiers you RESOLVED, not identifiers you were handed. It is the general
limit of the evidence corpus rather than a new one — any tool that echoes its
arguments into its result has always grounded them.

## Survival: appended, not requested

A ledger the model can drop is worthless, and *every* mechanism that ASKS the
model to carry it can be dropped — a note in the result is advice, a prompt rule
is advice, and a judge that reads the answer back to ask "did it state its
limits?" needs a second model to decide what counts, which is the one thing this
library refuses to put in a guard.

So `.limitsTravelWithTheAnswer()` **appends**. The framework composes the block
from what the tools declared and concatenates it onto the final answer. The
model does not write it, so the model cannot drop it. It changes the answer's
bytes, which is why it is opt-in; the recording half runs either way.

It is **not** enforcement of the model's prose. It does not check that the model
stated the limits, and it does not refuse an answer that did not.

## Files

| file | one job |
|---|---|
| `types.ts` | the shared vocabulary — `CoverageItem`, the three lists, the two rendered shapes |
| `items.ts` | normalize and REFUSE a declaration, at the call site |
| `absent.ts` | `absent()`, the recognizer, the static note |
| `ledger.ts` | `coverage()`, the recognizer, the static note |
| `read.ts` | the ONE reader both dispatch boundaries call |
| `evidence.ts` | what an absence is allowed to ground |
| `answer.ts` | folding the run's declarations into one appended block |

## Zero-cost when unused

An agent whose tools return neither shape is byte-identical: two `typeof`
checks per result and `undefined` back, no scope key, no event, no chart
difference (the final branch mounts the stage function it always mounted).
Pinned by `test/core/agent/coverage-zero-cost.test.ts`.
