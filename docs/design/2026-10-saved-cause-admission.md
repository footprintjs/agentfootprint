# Saved root cause admission contract

**Reviewed design snapshot.** This proposal was approved in PR #215 before implementation.
The first follow-up implemented Step A and graph-only serving. A later adoption implements
Step B for the first root segment when the public producer reader admits captured native
ownership evidence. Missing ownership stays unknown; staged, child and resumed source joins
remain deferred. The original proposal below remains a design snapshot.
The proposal wording below records the reviewed contract, rather than current release status.

Implementation bounds: producer reading defaults to 16,384 entries, 4,096 missing-commit
rows, 64 drill-path segments and 2,048 address characters. Host overrides are finite
non-negative integers, capped at 65,536 entries and the other default ceilings.
Acknowledged-history copying permits JSON depth 256; existing generic copier callers
retain their depth-100 default. Projection still refuses over 4,096 nodes or commits.

## Existing owners and intended boundary

`src/trace-toolpack/causeCapture.ts` admits completed native v1 root logs;
`causeControl.ts` checks same-run control; `causeSnapshot.ts` projects a `RecordScope`
into public `createRecordGraph`; `causeReader.ts` and `causeResponse.ts` own queries
and fixed disclosure text.
`TraceToolpackArtifacts.cause` in `src/trace-toolpack/types.ts` already accepts a
host-authorized graph. Saved-only serving needs the graph-only path proposed below.

FootPrint owns stored protocol validation for one authorized root history;
Foottrace owns source admission, graph IDs and walking; AgentFootprint owns policy and serving.
Future implementation requires public `foottrace` ^1.8.0 and development checks
against public `footprintjs` 10.5.0 or later. This changes no manifest or broad
FootPrint peer range; the new helper alone requires the newer producer reader.

## Proposed host API

Future export: existing `agentfootprint/observe` via `src/trace-toolpack/index.ts`,
`src/observe.ts` and `src/doors/observe.ts`. Contract sketch, not a runnable example:

```ts
interface ReadStoredCauseOptions {
  readonly runId: string;
  readonly readerLimits?: StoredRecordLimits; // public foottrace type
  readonly maxBytes?: number; // default 1 MiB; integer 1..8 MiB
  readonly signal?: AbortSignal;
}
type StoredCauseUnknown =
  | 'invalid-data' | 'reader-limit' | 'stored-admission' | 'native-capture'
  | 'projection-incomplete' | 'source-ownership-unproven' | 'source-incomplete'
  | 'cancelled' | 'unsupported' | 'unavailable';
interface StoredCauseAdmission {
  readonly native: {
    readonly status: 'admitted' | 'incomplete';
    readonly reason: CaptureReason; // existing fixed consumer-policy reasons
    readonly version: 1; // Step A; v2 remains unknown pending Step B
    readonly scope: 'root-log';
    readonly persistence: 'memory-only';
  };
  readonly storage: {
    readonly status: 'adapter-acknowledged-history';
    readonly scope: 'root-log';
  };
  readonly readSources: 'not-collected'; // Step A
}
type StoredCauseArtifacts = TraceCauseArtifacts &
  { readonly admission: StoredCauseAdmission };
type StoredCauseResult =
  | { readonly status: 'ready'; readonly cause: StoredCauseArtifacts }
  | { readonly status: 'unknown'; readonly reason: StoredCauseUnknown; readonly cause?: never };
declare function readStoredCauseArtifacts(
  entries: Iterable<unknown>, options: ReadStoredCauseOptions): Promise<StoredCauseResult>;
declare function traceCauseTools(cause: TraceCauseArtifacts, options?: TraceCauseOptions): Tool[];
```

Both names require review. A saved-only host awaits the factory, checks `status`,
then calls `traceCauseTools(result.cause, hostCeilings)` for a ready result. Its normal
tool interface mounts those three tools, without a `RuntimeSnapshot` or unrelated
legacy trace tools. Unknown has no graph or tools to mount.

The host authorizes storage, selects the run and supplies a trusted producer's
iterable. A receipt is an adapter assertion, not a signature, producer identity or
independent storage audit. Self-consistent rewrites can pass unsigned digests.
Persisted rows, filenames, run IDs and model output never grant ownership/authorization.

Options are copied from own data with fixed validation. Invalid options return
`unknown`; exceptions and producer reason strings map to the fixed union above,
never to returned payloads, paths, receipt contents or exception text. Cancellation
is checked before admission and after its await; a cancelled result is discarded.
FootPrint's reader synchronously iterates before awaiting digest validation and
accepts no signal or clock. This factory cannot preempt that work or a blocking
host iterator; structural reader limits bound data work, not arbitrary host code.

The adapter calls public `footprintjs/trace.readStoredCapture` **once**, with
`runId`, `limits: readerLimits` and `maxBytes`. It consumes only an acknowledged
result's `history`. It neither copies the producer validator nor accepts a caller's
history/receipt as an alternate path. Reader refusal returns unknown without a
graph or fallback to raw entries. Owner: FootPrint `src/lib/runner/readStoredCapture.ts`.
Resolve only standard `footprintjs/trace` when the factory is invoked; no `/sinks`
import, storage fetch or compatibility validator. A missing public reader returns
fixed `unsupported`; missing `globalThis.crypto.subtle` returns `unavailable`.
Neither failure changes barrel loading, browser boundaries or the default path.

## Step A: usable saved v1 native-root admission

Extract a narrow shared basis/projection from current helpers. Never cast saved
history to `RuntimeSnapshot`, synthesize a full snapshot or pair histories. Use only
this history's run/capture/log/tree/recorders/absent/base. Step A returns v2 unknown.

Reuse the completed-root policy: matching root identity with empty `drillPath`,
range `[0, commitLog.length)`, completed boundary, full read/write tracking,
full or delta values, reads-prefix provenance and captured reads, writes,
attention and control. Preserve capturedControl's single acknowledged producer
rule. Invalid identity/shape, ambiguous tree identities and unsupported future
metadata return `unknown`. An acknowledged, safely projectable partial capture
uses the existing incomplete projection: `complete: false`, fixed capture reason
and explicit gaps; required-channel loss never becomes complete because of storage.
Use a data-only index capped at 4096 nodes/commits; cycles, over-limit inputs and
projection loss fail closed without truncating proof.

V1 retains current base limitations and `readSources: 'not-collected'`. Future
versions, fields and limitations are refused. Only completed full required channels
may make `complete: true`; known partial modes/channels, missing control/tree coverage
and incomplete boundaries retain the current incomplete graph where safely
projectable, otherwise unknown. Resumed/child admission is out of scope. Storage
never upgrades any channel or the execution boundary.

Keep `history.absent` beside the tree. Its paths identify literal own undefined
`stageReads`/`stageWrites` observations omitted by JSON. Add validated omitted read
keys to the corresponding stage's read-key set; preserve write-omission facts
without inventing a value, write or source. Never split a business key on dots,
slashes or numeric-looking text, mutate the frozen history, or reinterpret an
omission as proof that the state key never existed. FootPrint validates the
sidecar and digest; this adapter projects those facts without a second wire codec.

Create one canonical root `RecordScope` from that basis and call public
`createRecordGraph`; expose its root discovery through the existing graph seam.
No local dependence walker, source replay, root ranking or ID scheme is added.
The factory privately retains a detached bounded history projection, freezes its
cause object/graph surface, and keys a private WeakMap by exact cause identity.
It holds the original graph reference and detached immutable private assessment;
public admission is a separate display copy, never serving authority.
Only the issuing module instance recognizes that identity; serialization, copies or
cross-CJS/ESM-instance transfer lose it. Generic graphs without a stored claim keep
existing host authorization. Counterfeit/spread/replaced-graph inputs carrying an
admission claim receive fixed invalid-data gaps from all three tools before any
graph query; no borrowed root or assessment. Mutation cannot preserve old authority.

## Step B: v2 exact-source admission deferred

Foottrace's public `RecordScope.readSources` accepts
`{ record, executions: [{ runtimeStageId, stateAddress, attemptIds }] }`.
Its bindings are host-authorized assertions, not established by a codec-valid
packet. Owners: Foottrace `src/lib/cause/recordSources.ts`; FootPrint
`src/lib/capture/storedReadSources.ts` and `storedReadSourceCounts.ts` already check
same-history identity/range, native counts and scalar references, not every binding.

Available independent evidence is the vouched root/range, committed owners joined
to the vetted public tree, native `readSourceCounts`, and retained `kind: 'stage'`
attempt tuples whose `series` matches the owner. Public `buildAttemptId(series,
attempt)` encodes those tuples; call/observed attempts and summary totals cannot
replace them. Verify namespace and attempt extent for the same root/segment,
including zero-read owners, and keep the earliest reader-commit boundary. Never
reconstruct occurrences, copy `stateAddress`/`attemptId` from rows into their own
authorization list, infer empty namespace from root address, derive ownership from
a filename or invent attempt 1. Grammar-valid identity is not ownership proof.

A verified ordinary two-step, no-retry run on public FootPrint 10.5.0 retained
source counts, but its nodes had no `attempts` and the read occurrence had no
`attemptId`. The public saved tree also does not establish every state namespace.
**Every otherwise admitted v2 input returns source-ownership-unproven unknown
without a graph** until a reviewed producer witness contract proves both. Step A
does not implement v2; neither attempt 1 nor an empty namespace may be invented.

After that gate, require matching root, segment 1 and consistent native counts;
pass the admitted record, verified bindings and same-history base to Foottrace.
Its public source admission owns scalar/base/committed reference and ordering
checks. Unavailable, redacted, composite, staged, untracked, exhausted or mismatched
evidence keeps gaps without temporal fallback or semantic/per-write derivation.
Supported partial observations may remain in an incomplete graph; gaps never prove
observed-empty or a unique root. Missing/unverifiable bindings stay unknown.

## Graph-only serving and compatibility

`traceCauseTools` returns exactly `attention_list`, `root_cause` and `impact`.
Use one internal context union: `{ kind: 'graph', cause }` or
`{ kind: 'snapshot', artifacts, nodes }`. Reuse `causeTools.ts`'s three definitions,
limits, loading, public query and response path; no duplicate registry, second walker,
snapshot indexing/projection on graph input, reread or repeated admission. Existing
snapshot/plain custom-graph paths retain exact tool bytes. Only graph-only serving
consults saved private assessment. A stored-claim cause passed to full traceToolpack
is rejected with a fixed refusal before indexing; matching-bag support is not proposed.

Only a factory-owned ready `cause` carries saved authority. `causeReader.ts` and
`causeResponse.ts` would disclose separate native and storage assessments in
fixed words through the private binding, never by trusting a caller's `admission`
property. Preserve the original native note's `memory-only` persistence and
`storage-not-attested` limitation: the separate receipt concerns these saved
bytes, not the native note's authority, child delivery or whole-workflow storage.
An admitted graph still has Foottrace query gaps; ready never promises a root.

Cause-tool schemas, descriptions, query ceilings and model arguments stay unchanged.
Paths, URLs, run selectors, receipts and limits remain host-only. Existing native
memory and ordinary custom-graph responses must stay
byte-identical when the new factory is unused, including omitted optional fields.
`openSubflowArtifacts` must never inherit a root's graph or admission metadata.

## Offline acceptance matrix for future implementation

Use public packages in CJS/ESM on supported Node versions; no model, provider, business rerun or vendor.

| Case | Required result |
| --- | --- |
| Real completed v1 root, recovered retry, decisions, JSON storage/reload | Ready; canonical IDs/root/path/impact equal the corresponding memory graph, apart from explicit saved metadata. |
| Ordinary v2 two-step run: native counts but absent attempts/attemptId | Step A fixed source-ownership-unproven unknown; no graph, tools or invented binding. |
| Step B after a reviewed producer witness contract | Independently proven namespace/attempt extent required before source readiness; exact earlier committed source wins over a later candidate in both directions. |
| Missing reads/undefined writes; literal `a.b`, `a/b`, `0` keys | Sidecar observations survive; no path/key confusion or invented value/source. |
| Missing/duplicate/mismatched receipt; changed tree/log/base/absent/source | Fixed unknown; no graph, root, private text or caller-supplied replacement. |
| Reordered/missing end/commit; future/self source; foreign owner/namespace/attempt; missing/inconsistent/future counts | Fixed unknown; no self-authorization, fallback candidate or observed-empty claim. |
| Legacy/future note, extra limitations, resumed/child | Unknown; no storage-driven promotion. |
| Known partial modes/channels, missing control/tree coverage; failed/paused/cancelled | Existing safe incomplete projection with fixed reason/gaps, otherwise unknown; never complete. |
| Counterfeit/spread/copy admission; replace/mutate graph; same IDs with changed history | Fixed invalid-data gaps before graph query; no copied saved authority, root or assessment. |
| Exact factory instance within CJS or ESM; cross-instance transfer | Each format works within its issuing instance; mixed-loader/copy/serialization claims fail closed. |
| Plain custom graph without stored claim | Generic graph-only and legacy custom-graph behavior/bytes retain host authority and no saved assessment. |
| Strict TypeScript saved-only consumer; CJS/ESM all three operations | ready -> traceCauseTools(cause) -> callTraceTool works without RuntimeSnapshot or other legacy tools. |
| Saved-claim cause passed to full traceToolpack | Fixed refusal before indexing; no combined saved/snapshot authority. |
| Child opening | No inherited root graph, receipt or source binding. |
| Accessors/toJSON, cyclic/oversized data, reader/graph/output bounds, cancellation; cause-query deadline | Bounded admission or fixed unknown/gap; late admission withheld; clipped proof never retains a supported root. |
| Factory unused: default memory/native-v1 and ordinary custom graphs | Exact response bytes, schemas, limits and package/runtime graph unchanged. |

Implementation needs tests, capability/example/guide updates, generated-doc gates,
and security then code review. Step B needs separate witness review and consumer code.
This docs-only contract requires source/manifest/lockfile parity with its base;
full checks remain required in CI before delivery. Child/resume admission, staged sources,
durable child assurance, re-ranking, storage adapters and application/UI rollout are out of scope.
