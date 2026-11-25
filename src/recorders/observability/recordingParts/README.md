**Trace** — a saved run recording cut into parts, and read back one checked part at a time.

# Recording parts

A whole recording is one artifact. To show any piece of it, a reader must read
and parse all of it. A big run then cannot be opened by a reader with a size
limit, even when the person only wants one sub-step. Saving the recording in
parts fixes that: opening reads a small index, the root reads one base part,
and one invocation reads the one part that holds it.

## The stored shape

All artifacts are JSON text, in the run's own scope.

| Artifact | Kind | Holds |
| --- | --- | --- |
| index (the receipt names it) | `recording/run-index` | refs, byte counts and SHA-256 of every part; every invocation's address and its part; aliases. No recorded value. |
| base part | `recording/run-part` | the recording without `snapshot.subflowResults` (the key itself is removed) |
| invocation parts | `recording/run-part` | whole subflow results, about 1 MiB per part; a bigger result is a part of its own |

A path alias of `subflowResults` whose JSON text equals one stored result is
stored only as `{ name, key }` in the index. Any other alias is stored in a part,
so reading the whole back restores everything the whole recording held.

`complete: false` says the tree and the results disagree (a mount with no
result, a result no mount reaches, a result in a shape the lazy viewer refuses).
Every result is still stored. A lazy viewer refuses such a recording whole, so a
host answers the same refusal.

With `packed`, each part is packed on its own (`recordingParts/packing.ts ·
packPart`), so any part reads alone. The index is never packed.

## Units

| File | Job |
| --- | --- |
| `format.ts` | formats, limits, and `readRecordingIndex`: the one admission of an untrusted index |
| `invocations.ts` | the walk: which invocations a snapshot holds, in the viewer's order |
| `split.ts` | the cut: base part, invocation parts, the index without refs, every digest |
| `source.ts` | where a part comes from (a store, or memory), checked against its index entry |
| `partReader.ts` | one part's bytes become values: caps, unpacking, exact key sets |
| `open.ts` | `openSavedRecording`: open either layout, then `readRoot`, `readInvocation`, `readWhole` |
| `packing.ts` | each part packed on its own with the recording codec |
| `file.ts` | the writer's sequence: every part, then the index; undo on any failure |
| `splitError.ts` | why a split was refused, in fixed sentences |

## Writing

`file.ts · fileRecordingParts` puts the base part, then each invocation part in
order, then the index, each with `digest: 'sha-256'`. After every put it checks
the store's byte count and digest against its own, and stops when a put's sweep
names one of this recording's own parts. The index gets the earliest part
expiry, so it never outlives a part. On any failure it deletes what it wrote
(best effort), writes no index, and returns a fixed sentence with counts. An
agent files this way with `artifacts: { recordings: { layout: 'parts' } }`
(`core/agent/runtime/recording/recording.ts · fileInParts`).

**Refuse before writing when it cannot fit.** Retention judges each put alone,
so parts that each fit a scope but together do not would evict the scope's other
artifacts first and only then reach the recording's own part. So the writer asks
the store's optional `scopeBudget` before its first put and refuses with
`would-not-fit` when the parts plus the index exceed the byte budget, or parts + 2
exceed the count budget: no put, no sweep, nothing deleted. This is the ONE store
capability the layout adds, against the design's "no new capability": a
statement of the retention every in-tree adapter already enforces
(`artifacts/retention.ts · retentionBudget`), not a reservation. It proves the
recording fits an EMPTY scope, as the whole layout's up-front refusal does; a
filing may still evict older artifacts, as a whole recording does. A store
without the member keeps the plain behaviour (a 100 KB scope holding a 60 KB
dataset, and six 20 KB parts, ends empty).

**The refusal sentence.** It is the writer's own: a fixed sentence naming the
step by its code in parentheses (`would-not-fit`, `store-refused`,
`store-mismatch`, `evicted-own-part`, `not-split`, `unexpected`) with counts. A
parts filing is several puts and a delete pass, so the one refusal summarises
the filing rather than quoting one put's error; the whole layout is one put, so
the store's own sentence is its whole story and is passed on.

**Not guarded.** Two runs filing into one scope at once can evict each other's
parts; the reader then reports `part-missing` for exactly those. Filing takes no
cancel signal. A process that dies between puts leaves parts with no index,
unaddressable, counted against the scope until retention removes them.

A store that keeps no digest still files: the index carries the writer's own
SHA-256 of every part, the writer compares the store's digest only when it has
one, and the reader verifies every part by its own hash.

## The walk exists twice

The invocation walk mirrors the lazy viewer's own walk: the viewer package's
`recordingSourceCodec/nativeIndex.ts`, functions `scopeMounts` and
`indexNativeRecording`. A nested invocation's address is found inside its
parent's result, so an index that does not hold the results must carry every
address, and AgentFootprint computes them when it cuts. The test tree keeps an
independent copy of the viewer's walk as an oracle
(`test/recorders/observability/recordingParts/viewerWalk.ts`); the host
application's own test checks the published viewer package against this one.
Moving the viewer onto this walk is a separate change.

## Example

```ts
import { openSavedRecording } from 'agentfootprint/observe';

const saved = await openSavedRecording(ctx.artifacts, receipt.ref, { maxPartBytes: 4 * 1024 * 1024 });
if (saved.status === 'ready') {
  const root = await saved.readRoot();
  const call = await saved.readInvocation(saved.invocations[0].key);
  if (call.status === 'unavailable') console.log(call.reason); // 'part-missing', 'part-changed', …
}
```

## Laws

- Metadata before bytes: every cap is decided from the index, or from `head`,
  before any `get`. A part's kind, byte count, digest and run are checked
  against the index before its `get`; its own SHA-256 is recomputed after.
- The ticket first: `head` must answer for the ref asked, with a size that is
  a whole number, before any cap reads it. A whole recording gets the index's
  checks too: its exact length and, when the store stamped one, its digest.
- Exactly the invocations a part held: a missing, changed or oversized part is
  unavailable for its invocations only. `readWhole` is all-or-nothing, and its
  `maxBytes` bounds the plain total: each packed part may expand only to what
  the parts before it left.
- No renaming of failures: a busy or revoked store and an aborted signal are
  thrown as they are, never reported as a missing part.
- No value in a refusal: reasons are fixed codes, and the index holds no
  recorded value.

Tests: `test/recorders/observability/recordingParts/`.
