# `src/lib/bug-report/` — the run, packaged as evidence

A bug report IS the run. `describeBugReport` measures it into selectable units
so a human can consent; `exportBugReport` bundles exactly what they kept as
named files plus a real (stored) zip. `githubBugReporter` — in
`src/adapters/observability/` — files that bundle.

```
build.ts        the two entry points: measure, then bundle
envelope.ts     fold the evidence into the archive contract, or say why not
transcript.ts   events → readable turns (conversation.json)
zip.ts          a store-only zip writer, zero dependencies
types.ts        the manifest and the units it offers
```

## The bundle, layout 2

`manifest.manifestVersion` is the layout version — a versioned artifact that
cannot say its version is not one.

| file | what it is |
|---|---|
| `manifest.json` | the honest statement of the selection — always present, never a unit |
| `envelope.json` | the run as a `RecordingEnvelope`; the canon `{ snapshot, events, structure }` is its `recording` field |
| `recording.json` | the bare recording — **only** when the envelope's run facts were not available |
| `conversations/<id>.json` | one file per conversation when there is more than one run |
| `conversation.json` | the readable transcript |
| `narrative.txt` | the narrative recorder's lines, when one was attached |
| `environment.json` | the HOST that ran it (Node, platform, arch) + the reporter's prose |

Three rules hold this together:

1. **One archive contract.** The evidence rides in the same `RecordingEnvelope`
   `persistRecording` writes, built through `buildRecordingEnvelope` — never a
   second implementation. That is why `environment.json` no longer carries
   `agentfootprint` / `footprintjs` versions: the envelope's `producer` stamps
   them, once.
2. **Never pack the run twice.** An envelope *or* a bare recording, never both.
   The zip is store-only, so a duplicated recording is duplicated bytes against
   a ceiling the reporter has to fit under.
3. **Refuse in place, not by throwing.** `exportBugReport` can state only
   `run.complete` and `run.droppedEvents` (a bundle may hold several runs, so a
   single `runId` or `startedAt` cannot be true of all of them). When a fact is
   missing the conversation rides bare and the manifest NAMES the fact — the
   reporter still gets a filable bundle, and nothing is stamped that was not
   known.

## Reading the code

Start at `build.ts`'s `plan()`: it normalizes the three input shapes, groups
runs into conversations (a session outlives a run, so several runs of one
session are ONE unit), stamps each conversation through `envelope.ts`, and
returns the file BUILDERS. Selection then rebuilds the derived files over only
the chosen conversations — which is what keeps a deselected conversation out of
the transcript and the narrative as well as out of its own file.
