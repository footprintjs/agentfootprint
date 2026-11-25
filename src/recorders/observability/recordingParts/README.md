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
| `splitError.ts` | why a split was refused, in fixed sentences |

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
