**Mixed** — the leaves every layer must agree on.
Fold owners: `spokenIds.ts` (which ids a filtered sentence may NAME, and whether
the set was non-empty before the filter), `saidByPerson.ts` (which `role:'user'`
turn a PERSON wrote), `iterationBudget.ts` (how many actions a turn has left —
the number a model is told), `toolBytes.ts` (where a tool's OWN words end in a
result message the library annotated). All four live here rather than beside
their first caller so that readers in folders that cannot import each other
cannot answer the same question differently.
Support: `canonicalJson.ts`, `fnv1a.ts`, `lazyRequire.ts`, `libraryVersion.ts`,
`sqliteUnavailable.ts`, `embedderMismatch.ts`, `storedPreview.ts`, `sleep.ts`.
Every subfolder here has its own role and its own README.

## What it reads / what it writes
Nothing on scope. These are zero- or near-zero-import leaves: values in, values
out, all detached (`spoken()` returns a fresh `{ named, held }`).

## The one law here
One owner per fact. When two layers must agree about a fact and cannot import
each other, the fact moves HERE — that is exactly why `spokenIds.ts` exists
(`spokenIds.ts` · "── WHY THIS IS A LEAF AND NOT A HELPER IN THE GATE") and why the writers of library-authored turns import the
prefixes the recogniser matches on (`saidByPerson.ts`).

## A wait from here is never early
`sleep.ts` · `sleep` is the library's ONE wait: the retry back-offs, the
device-flow poll, the mock provider's thinking time and the sign-in door's
minimum answer time all go through it. It never resolves before `ms` of
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

## Files
- `spokenIds.ts` — `named` vs `held`; `held` is required, not optional.
- `saidByPerson.ts` — the opening registry and the `injectedBy` marker.
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
