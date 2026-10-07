**Mixed** — the leaves every layer must agree on.
Fold owners: `spokenIds.ts` (which ids a filtered sentence may NAME, and whether
the set was non-empty before the filter), `saidByPerson.ts` (which `role:'user'`
turn a PERSON wrote), `iterationBudget.ts` (how many actions a turn has left —
the number a model is told), `toolBytes.ts` (where a tool's OWN words end in a
result message the library annotated). All four live here rather than beside
their first caller so that readers in folders that cannot import each other
cannot answer the same question differently.
Support: `canonicalJson.ts`, `fnv1a.ts`, `lazyRequire.ts`, `libraryVersion.ts`,
`sqliteUnavailable.ts`, `embedderMismatch.ts`, `storedPreview.ts`, `sleep.ts`,
`linearText.ts`.
Every subfolder here has its own role and its own README.

Trace owner: `trust-boundaries/` projects selected typed events into a bounded,
content-minimized capture window. Its snapshot reads that runtime-owned record;
it never reconstructs policy decisions from the completed run.

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
`core/time/resolve.ts` · `placeBeforeTime`, `ontology/skosJsonLd.ts` ·
`withoutQuery`, `core/time/readers/english.ts` · `saysBetweenBefore`): linear
in the text, equal to the regex they replaced — `stripTags` to that regex with
its end tag corrected to the one a browser ends a script at. `core/time/`
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
- `linearText.ts` — `trimLeading` / `trimTrailing` / `trimBoth` over a
  `CharTest` (`isSlash`, `isHyphen`, `isRegExpWhitespace`, `anyOf`, `either`):
  the regex's answer in one pass.
