**Mixed** — the leaves every layer must agree on.
Fold owners: `spokenIds.ts` (which ids a filtered sentence may NAME, and whether
the set was non-empty before the filter), `saidByPerson.ts` (which `role:'user'`
turn a PERSON wrote), `iterationBudget.ts` (how many actions a turn has left —
the number a model is told), `toolBytes.ts` (where a tool's OWN words end in a
result message the library annotated), `normalize.ts` (one spelling per value
— the evidence gate and the inputs layer compare by it, and a reader in any
layer may). All five live here rather than beside their first caller so that
readers in folders that cannot import each other cannot answer the same
question differently.
Support: `canonicalJson.ts`, `fnv1a.ts`, `lazyRequire.ts`, `libraryVersion.ts`,
`sqliteUnavailable.ts`, `embedderMismatch.ts`, `storedPreview.ts`, `sleep.ts`,
`abort.ts`, `linearText.ts`, `utf8.ts` (the one measure of a string in UTF-8
bytes — a code runner's payload and a script on the record are bounded in it).
Moved down from beside their first callers, so that no layer imports upward for
a name both sides use (the layer table, `scripts/layering.config.cjs`):
Map: `conventions.ts` (the builder↔recorder protocol — subflow and stage ids,
injection keys, the receipt's scope key `RECEIPT_KEY`), `moments.ts` (the five
places in the loop where a rule may speak), `traceToolNames.ts` (the trace tool
names `.selfExplain()` reserves before the pack loads, and its "no run yet"
answer), `scriptRecord.ts` (the vocabulary of a code call on the record — the
label its execution record earns, the verdict on a shown block, the attached
script — which the agent's script record and the event payloads share). Fold: `stableJson.ts` and `sha256.ts`, the two halves of every
fingerprint the library mints (sorted-key JSON, then the hash). Support:
`toolName.ts` (the LLM tool-name law `defineTool` checks), `humanizeLLMError.ts`.
These loose files, `claim/` and `context-contract/` import nothing in `src/`
outside themselves at run time — a type-only import, such as `conventions.ts`
naming `events/types.ts` · `ContextSlot`, is erased and is not an edge;
`npm run check:layering` refuses a run-time import that would leave the set.
Every subfolder here has its own role and its own README.

## What it reads / what it writes
Nothing on scope. These are zero- or near-zero-import leaves: values in, values
out, all detached (`spoken()` returns a fresh `{ named, held }`).

## The one law here
One owner per fact. When two layers must agree about a fact and cannot import
each other, the fact moves HERE — that is exactly why `spokenIds.ts` exists
(`spokenIds.ts` · "── WHY THIS IS A LEAF AND NOT A HELPER IN THE GATE") and why the writers of library-authored turns import the
prefixes the recogniser matches on (`saidByPerson.ts`).

## A line the library serves is never the person's
`saidByPerson.ts` · `isSaidByPerson` is the one answer to "did a person write
this `role: 'user'` message?", and every line this library writes in that
role carries an opening from `LIBRARY_AUTHORED_PREFIXES` — the frames it puts
in `history` AND the lines it serves on a request only: `LIBRARY_NOTE_OPENING`
(the time layer's late line, `arguments/serve.ts` · `TIME_LINE_SOURCE`, and
the figures dial's conclusion) and the staged-refs nudge. A writer imports its
opening from here; it never types its own copy. A message marked `ephemeral`
(a retry's feedback, on one attempt's request) or `injectedBy` is never a
person's either.

Why: "never in history" is not "never read as the person". Under `.time()`
the library's note is the LAST message of every request, so a reader that
took the last user-role message of what the model was sent — the mock's
default echo, the window's `currentRequestIndexOf`, a host finding "this
turn" — anchored on the library's line (G17). Readers of the recorded history
ask the same rule (`answer-account/facts/common.ts` · `isPersonEntry`), so a
correction frame after a turn's results never becomes "the current request".

```ts
import { isSaidByPerson, LIBRARY_NOTE_OPENING } from 'agentfootprint';

const last = request.messages[request.messages.length - 1]; // under .time(): the library's note
isSaidByPerson(last); // false — it opens with LIBRARY_NOTE_OPENING
const said = [...request.messages].reverse().find((m) => isSaidByPerson(m)); // the person's words
```

## A wait from here is never early
`sleep.ts` · `sleep` is the library's ONE wait: the retry back-offs, the
device-flow poll, the mock provider's thinking time and the sign-in door's
minimum answer time all go through it. (One back-off does not: the MCP retry,
`mcp/throttleRetry.ts`, runs on footprintjs's `attempt()`, which waits on its
own timer.) It never resolves before `ms` of
MONOTONIC time have passed. A bare `setTimeout` cannot promise that — Node's
loop clock counts whole milliseconds and floors the stamp it arms with, so a
timer fires up to a millisecond early, and more on Linux, where the loop clock
is the coarse one. So the deadline is read from `performance.now()` when the
wait starts, and a timer that fired early is re-armed for what is left (rounded
up, split below 2^31 ms) until the clock has passed it.

```ts
import { sleep } from '../lib/sleep.js';

await sleep(retryDelayMs * 2 ** attempt, signal, abortReason); // at least that long, on performance.now()
await sleep(0, signal); // no wait: resolves at once, nothing to cancel
```

It promises a minimum, never a maximum — a loaded host wakes a timer late. A
timer that BOUNDS work (abort after `ms`, a grace or flush timer) is not a wait
and stays beside the work it bounds. `test/lib/sleep.test.ts` proves the law
with a timer that fires early on purpose; `test/architecture/sleepOwner.test.ts`
refuses a private sleep anywhere else in `src/`.

## A cancellation from here stops everything after it
`abort.ts` is the one owner of how the library honours an `AbortSignal`. Once a
request's signal has fired, nothing more is sent (`throwIfAborted`), nothing more
is waited for (`untilAborted` races every wait), nothing more is read
(`abortableIterable` and `bodyChunks` close the stream or cancel the body), and
nothing that lands late counts: a response that arrives after the abort is
refused with it, so it is never recorded as an answer or billed into a run's
usage. The error is the signal's own `reason` when that is an `Error` (an
`AbortError`-named one otherwise), so a caller gets back what they aborted with.
`linkedController` is a controller that follows the caller's signals until
`unlink()` (a run, a call), so no listener outlives the work on a long-lived
signal; `armDeadline` aborts it after `ms` and returns the disarm, so a deadline
never fires on work that already finished; `eitherSignal` combines signals
where nothing has a lifetime to end (`AbortSignal.any`); `callUnder` is the
four laws for one non-streaming provider call. `abortErrorOf` never throws,
even on a reason that cannot be inspected.

```ts
import { callUnder } from '../lib/abort.js';

const response = await callUnder(request, scope.$getEnv?.()?.signal, (wired) =>
  provider.complete(wired),
);
```

## A trim from here costs one pass
`linearText.ts` is where a run of characters comes off the end of text the
library did not write: a base URL or prefix from configuration, a token or a
reply from a model, a value from a person's message. Never
`s.replace(/\/+$/, '')`: without a `^`, a backtracking engine starts that
pattern at every position and re-reads the run each time, so a long run followed
by one more character costs its length squared (16,000 slashes ~90 ms, a
million — minutes, with the event loop blocked). `trimTrailing` walks in from
the end once and returns exactly what the regex returned.

```ts
import { anyOf, isSlash, trimTrailing } from '../lib/linearText.js';

trimTrailing('https://api.example.com///', isSlash); // 'https://api.example.com'
trimTrailing('41200%.', anyOf('.,;:!?%')); // '41200'
```

The same rule holds for the scanners that live beside their one caller
(`rag/splitters/byHeading.ts` · `atxHeadings`, `rag/loaders/html.ts` ·
`stripTags`, `core/codeRunnerTool.ts` · `codeShape`,
`memory/facts/patternFactExtractor.ts` · `firstEmail`,
`adapters/identity/directory/ldapDirectory.ts` · `pemCertificateBlocks`,
`time/resolve.ts` · `placeBeforeTime`, `ontology/skosJsonLd.ts` ·
`withoutQuery`, `time/readers/english.ts` · `saysBetweenBefore`): linear
in the text, equal to the regex they replaced — `stripTags` to that regex with
its end tag corrected to the one a browser ends a script at. `time/`
imports nothing outside itself, so it restates the walk and the character
tests it needs instead of importing them.
`test/security/linear-text.test.ts` and `test/security/linear-scanners.test.ts`
pin both halves — equivalence on seeded strings, and a COUNTED work bound on
each regex's worst case (`test/helpers/workCount.ts`, never a timer).

## Files
- `spokenIds.ts` — `named` vs `held`; `held` is required, not optional.
- `saidByPerson.ts` — the opening registry (history frames and request-only
  late lines), the `injectedBy` marker and the `ephemeral` flag.
- `iterationBudget.ts` — `iterationsRemainingOf`, computed once.
- `toolBytes.ts` — `toolBytesOf`: a result's content cut at the tool-bytes
  boundary (`LLMMessage.toolChars`, honesty layer 2). The evidence index, the
  answer's standing, the answer account and the unsupported-argument and
  empty-lookup seams read results through it, so the inputs layer's note is
  never read as the tool's words.

  ```ts
  toolBytesOf({ content: '[]\n\n[window was not in … "2h" …]', toolChars: 2 }); // '[]'
  ```
- `canonicalJson.ts`, `fnv1a.ts` — deterministic serialization and hashing.
- `lazyRequire.ts`, `sqliteUnavailable.ts`, `embedderMismatch.ts` — optional-peer
  loading and its two shared refusals.
- `libraryVersion.ts`, `storedPreview.ts` — provenance stamp; how much of
  somebody's stored data a refusal may quote.
- `sleep.ts` — `sleep`, the one wait that keeps its minimum; `makeSleep` builds
  one over a test's own clock and timer.
- `longTimeout.ts` — `setLongTimeout(fn, ms, { unref? })`, a timer for a
  limit of any length: `Infinity` arms none, and a delay past 2^31 − 1 ms (the
  most one host timer holds, which Node fires after 1 ms) is waited in chained
  timers, never early. Used by the shutdown deadline
  (`strategies/flushDeadline.ts`). footprintjs has the same helper
  (footprintjs#136) but keeps it private, so agentfootprint keeps its own copy
  until footprintjs exports a supported long-timer helper.

  ```ts
  const cancel = setLongTimeout(() => giveUp(), timeoutMs); // Infinity: no timer; 30 days: 30 days
  ```
- `abort.ts` — the cancellation law: `throwIfAborted`, `untilAborted`,
  `abortableIterable`, `bodyChunks`, `callUnder`, `eitherSignal`,
  `linkedController`, `armDeadline`.
- `normalize.ts` — `normalizeToken`, `tokenize`, `canonicalForm`, `lookupForms`:
  one spelling per value, on both sides of every comparison. Moved down from
  `tools/` so a layer below the tools can share the gate's spelling.
- `linearText.ts` — `trimLeading` / `trimTrailing` / `trimBoth` over a
  `CharTest` (`isSlash`, `isHyphen`, `isRegExpWhitespace`, `anyOf`, `either`):
  the regex's answer in one pass.
