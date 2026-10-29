# Saved data references and bounded paging

**Status: approved in principle, 2026-10-19. Phase 1 is approved for implementation.**
This note proposes library contracts and implements nothing. It does not change the host app,
dependencies, releases, deployed storage policy or public exports. Only sections 1–2
are approved for a separate implementation PR now. The later sections record direction
and policy decisions; each later phase needs a short focused design, a real need and
fresh owner approval before code.

## Decision in one paragraph

Save an authorized, redacted snapshot first. Give it an existing `ArtifactRef`. Let the
model, generated code and a screen request bounded views of that same saved snapshot.
Check the current caller's permission on every request, including continuation pages.
Reuse the artifact store, retention planner, JSON detail viewer and hosting scope owner.
Add typed table views above the store, rather than a query language inside it. Make
oversized cause retention a per-app host choice, default off, in the conversation's own
store and scope until session end, capped at 24 hours and 1 MiB. Accept deferral of a
generic read lease: today's adapters cannot make its proposed guarantee. Coordinate
exact read provenance with Foottrace after footPrint #113 before adding an export mapping.

This is a library for different applications and storage backends. The host app's proof viewer
is one field example of domain admission composed with the shared viewer.

## Source baseline and existing owners

Inspected agentfootprint main at `1573b71310241b61bba730f57381e1223268f02f`
(the release containing the shared detail viewer), the artifact files at Lens local
`origin/main` `accb2a0`, and Foottrace local `origin/main` `29f628e` (the per-step
PROV translator). Source citations below use
**file · symbol**, so they survive edits that move lines. Names in API sketches are
proposals unless explicitly identified as existing. Sketches contain types only;
they are not runnable examples or promises that these exports already exist.

| Responsibility          | Existing owner to reuse                                                                                                                                                                                                                                                                                                             | Relevant boundary                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage and isolation   | `src/artifacts/types.ts` · `ArtifactStore`, `ArtifactScope`, `ArtifactMeta`                                                                                                                                                                                                                                                         | Five verbs, scope first; no `query` or `transform`. Scope is tenant/principal/conversation, not a run.                                                                       |
| Reference identity      | `src/artifacts/naming.ts` · `mintArtifactRef`, `isArtifactRef`; `src/artifacts/minting.ts` · `prepareArtifact`                                                                                                                                                                                                                      | One minted `art_` plus 22 base62 format. Digest is metadata, never an identifier. Parents must resolve in the same scope at mint.                                            |
| Bytes and integrity     | `src/artifacts/payload.ts` · `canonicalPayloadBytes`, `decodeCanonicalPayload`, `computeArtifactDigest`                                                                                                                                                                                                                             | One encoding/digest owner. Optional digests are verified by `get`; a `head` is not verification.                                                                             |
| Retention               | `src/artifacts/retention.ts` · `resolveExpiresAt`, `planRetention`                                                                                                                                                                                                                                                                  | TTL is stamped at mint; host/store policy can shorten, never extend it. Evictions are recorded facts.                                                                        |
| Adapters and laws       | `src/artifacts/inMemoryArtifacts.ts` · `inMemoryArtifacts`; `src/artifacts/fileArtifacts.ts` · `fileArtifacts`; `src/artifacts/sqliteArtifacts.ts` · `sqliteArtifacts`; `src/artifacts/s3Artifacts.ts` · `s3Artifacts`; `src/artifacts/gcsArtifacts.ts` · `gcsArtifacts`; `src/artifacts/conformance/` · `artifactStoreConformance` | Same port, different physical capabilities; absent capabilities remain absent.                                                                                               |
| Scope-bound tool access | `src/artifacts/capability.ts` · `bindArtifacts`, `ToolArtifacts`, `ArtifactEventFact`                                                                                                                                                                                                                                               | Tools receive an already-bound capability. Existing events are metadata only.                                                                                                |
| Placement               | `src/artifacts/placement.ts` · `placedResultKind`, `placedToolResult`; `src/core/agent/stages/toolCalls.ts` · `placeResults` inside `buildToolCallsStage`                                                                                                                                                                           | Stores finalized model-result **text**, after governance; precedence remains result ceiling, placement, last-resort truncation. Current placement requests no digest.        |
| Reference dispatch      | `src/artifacts/wants.ts` · `resolveToolWants`; `src/artifacts/present.ts` · `presentArtifact`                                                                                                                                                                                                                                       | `wants` currently loads whole data; `present` checks metadata and delegates rendering. Neither is a pager.                                                                   |
| Dataset publication     | `src/artifacts/datasetResult.ts` · `withDatasetArtifacts`, `stageDatasetArtifacts`, `DatasetArtifactInput`; `src/time/axis.ts` · `readTimeAxis`                                                                                                                                                                                     | Explicit producer declarations, source parents, semantics preservation and time-axis metadata; no inferred table schema or index. Writes are independent, not transactional. |
| Streaming               | `src/artifacts/streaming.ts` · `canGetArtifactStream`, `canPutArtifactStream`, `collectStream`                                                                                                                                                                                                                                      | Optional canonical-byte streams. Memory/SQLite do not implement them. Stream reads explicitly do not verify a whole-object digest.                                           |
| Code and recordings     | `src/core/codeRunnerTool.ts` · `codeRunnerTool`, `parentRefsOf`; `src/provider-contract/types.ts` · `CodeSession`, `canStageCodeInputs`; `src/artifacts/recordingArtifact.ts` · `recordingPutInput`                                                                                                                                 | Existing code staging and recording storage stay owners; file staging is not page-at-a-time access.                                                                          |
| JSON viewing            | `src/tools/artifactDetailTool.ts` · `artifactDetailTool`; `src/artifacts/detailRequest.ts` · `readDetailArgs`, `detailTokens`; `src/artifacts/detailView.ts` · `projectArtifactDetail`; `src/lib/boundedJson.ts` · `copyJson`, `ownData`                                                                                            | One request validator/projector. Fresh host admission, ordinary JSON only, 1 MiB input, 20 children, 12 KiB output, whole-scalar omission.                                   |
| Hosted redemption       | `src/hosting/artifactWire.ts` · `readArtifactWireOp`, `artifactWireBody`; `src/hosting/standingAgent.ts` · `answerArtifact`, `artifactsForRequest`, `sessionArtifactScope`, `heldBinding`                                                                                                                                           | Existing `artifact-head`/`artifact-get` door verifies ownership, composes scope once and makes foreign refs look missing. Reuse the per-session operation limit too.         |
| Screens                 | agentfootprint-lens `src/core/artifacts/types.ts` · `ArtifactResolver`; `src/core/artifacts/resolvers.ts` · `httpArtifactResolver`, `storeArtifactResolver`; `src/react/artifacts/ArtifactPane.tsx` · `ArtifactPane`; `src/react/artifacts/registry.ts` · `registerArtifactComponent`, `artifactComponentFor`                       | Resolver currently has `head`/`get`; the pane fetches the whole payload before choosing a component. A DOM row limit does not bound fetching.                                |

## Common contract and threat model

### Save first, then read

The reference identifies one saved payload, not a live query, URL, database cursor or
mutable "latest" handle. A refresh collects again and mints a new reference. New rows
in a source never appear in later pages of an old reference. Derived visible views and
indexes use the same store and reference format, with `parentRefs`; they are not a second
store. Publish a view only when all required parts have been saved and rechecked.
Missing parts cause an explicit unavailable result. Ordinary retention still applies.

The store does not perform redaction automatically. Materialization must run **after**
the host's visibility filtering and redaction. For caller-specific visibility, mint a
separate scoped visible snapshot. Do not fetch a sensitive master object, count all its
rows, then hide some cells on the way out. Field names, totals, sort keys, indexes,
parent metadata and caveats are all part of the information being authorized.
Hidden rows have no public ordinal; visible rows get dense snapshot ordinals.

### Admission and failures

Host-derived identity and scope never come from model arguments, generated code or
browser claims. Each page uses current session ownership, expiry, kind and size checks,
then any additional domain checks. The same applies to index/chunk dependencies.
Conversation admission does not prove producer identity, current-run provenance, domain
correctness or a causal conclusion. Applications may require those checks as well.

Use existing fixed `ArtifactDetailError` refusals for JSON viewing. The same public
unavailable response covers a foreign, revoked, expired, deleted, corrupt or missing
reference and host callback failure. Do not attach a count, label, digest, alternative
reference or exception text to that response. Hosting uses one indistinguishable 404
for unavailable artifacts. Malformed public request syntax is invalid regardless of
whether a reference exists; data-dependent checks run only after admission. An unknown
column and a hidden column receive the same fixed invalid response.

Permission is checked before serving and checked for cancellation/revocation at delivery
where the host can observe it. A page approved earlier gives no approval for a later one.
Cancellation stops waiting; it does not promise to stop a non-cooperative store request.
The design adds no new timing indistinguishability guarantee across network backends.

### Untrusted data, authority and determinism

Return source values as data in the existing `role: 'tool'` path, never as system
instructions or executable filters. Tool descriptions retain fixed safety wording;
any optional app hint follows it. `contextContractForModel()` in
`src/lib/context-contract/index.ts` is existing **opt-in guidance**, not an automatic
injection defense. Keep that choice explicit and test instruction-like names through
the real provider request boundary. JSON escaping alone is not a trust guarantee.

Reading a value does not satisfy a requirement or approve a claim. The existing claim
gate remains the owner. "Page complete" means a complete page of the authorized view,
not complete source coverage, a physical cause or complete proof.

For the same saved version, authorized visible view, normalized selector and effective
limits, successful data bytes are deterministic. No current clock, random token or
locale-dependent sorting enters the page body. Expiry, cancellation or changed
permissions can instead return unavailable; they must not return different data under
the same ref. Audit timestamps live outside the deterministic page payload.

### Bounds and ownership

Reuse `readDetailArgs`, `detailTokens`, `projectArtifactDetail` and `copyJson`; extend
their owning layer rather than adding an app parser. New tabular request validation is
a separate typed operation, not a second JSON pointer implementation. All host limits
are hard ceilings; the caller can only request less. Bound input bytes, nesting,
selector length, columns, predicates, scan work, index work, page output, retained
intermediate data and concurrent reads. Never silently switch from a range read to a
whole-object load. Never silently return a partial filtered result as exact.

## 1. Make placed results readable through the existing viewer

### Problem and options

Placement writes the exact finalized text that would have reached the model. Structured
results have `application/json` metadata but their stored `data` is a string; a string
tool result has `text/plain`. The JSON viewer currently receives structured JSON from
the host, so simply admitting the stored string shows one scalar.

Options are: change placement to write objects; add a second structured artifact beside
each ticket; or decode declared JSON text at the shared read boundary. Changing the
write changes `wants`/code consumers' data types and stored digest bytes. Dual writes
introduce retention and correspondence failures. Prefer the read-boundary option.

### Recommendation and API sketch

Keep placement bytes and old refs unchanged. One shared stored-record decoding path
uses the existing payload owner and platform JSON decoder, followed by `copyJson`.
For admitted `application/json` **text**, check the UTF-8 byte bound before parsing,
decode exactly once, and admit ordinary JSON within the existing depth and byte limits.
Already-structured JSON needs no parse. Do not recursively decode strings, infer formats
from content, revive special types or invoke getters. Use the existing JavaScript JSON
number semantics, then reject values `copyJson` cannot carry, including nonfinite values
and negative zero. This is not an arbitrary-precision decoder: producers requiring exact
large integers or decimals must declare strings. A malformed stored document is
unavailable, not a parser exception delivered to the model.
Non-JSON text retains whole-scalar omission; binary gets no fabricated JSON navigation.

Use an opt-in `reading` member of existing `AgentArtifactsOptions`. It mounts the
existing `artifactDetailTool` using the session admission in section 2, without an
app-written callback. Omitted means the existing tool catalog, prompts and tickets
remain unchanged. Reserve the mounted name at build time and reject name collisions.
Advertise an action only if the mounted reader can admit that kind and representation
within its actual limits. Tool availability and disclosure policy also apply when a
skill changes the tool catalog. A saved result above the viewer's 1 MiB ceiling has no
JSON detail action until an indexed bounded path exists; storage alone is not a paging
promise. A ticket must state that limitation.

```ts
// Proposed additions; existing AgentArtifactsOptions / ArtifactDetailAction are reused.
interface ArtifactReadingOptions {
  readonly admission: SessionArtifactAdmissionOptions;
  readonly name?: string; // default artifact_detail; validated as an ordinary tool name
}
interface AgentArtifactReadingAddition {
  readonly reading?: ArtifactReadingOptions;
}
interface PlacedResultReadingAddition {
  readonly detail?: ArtifactDetailAction;
  readonly detailUnavailable?: 'unsupported-format' | 'over-read-limit';
}
type StoredJsonView = (record: ArtifactRecord, maxBytes: number) => unknown;
```

`StoredJsonView` names a single proposed internal read-boundary contract, not a second
public parser. Choosing where it is exported, if at all, is an implementation review
decision. Only public configuration/action types need an existing package door.

### Proof, exclusions and migration

Tests must open a genuinely placed JSON result through its ticket, including a
pre-change text artifact; prove `get`/`wants` still receive original bytes/types; refuse
malformed, over-bound, deeply nested and nonfinite/negative-zero text; and keep text/plain
strings opaque. Test unsupported kinds, no reader, hidden reader, name collisions,
foreign refs, redaction and action/output bounds. Test the three ceiling precedences
and that the detail response cannot itself be placed into an endless ticket chain:
reader output must fit both its fixed bound and the host's downstream inline budget,
or return a short fixed refusal without another detail action.
The host app's #18-style regression is a **required phase 1 test**: pass an instruction-like
source label through the actual provider-port request boundary and prove it remains
tool data, without becoming or changing system instructions. A source-only assertion
or a future test plan does not satisfy this gate.

This does not page arbitrary oversized text, recordings or every binary media type.
It does not raise the JSON viewer ceiling or silently enable tools in existing apps.
The opt-in adds a model-visible tool and action fields, so text-based routing and prompt
snapshots may change for adopting apps. No write migration or compatibility wrapper is
proposed. Apps upgrade together to the newest library API.

## 2. Ready-made admission for this conversation's saved data

### Problem and options

Every app currently writes an `admit` callback. Options are accepting ref possession
as authority, accepting arbitrary scope arguments, or reusing the framework's existing
scope-bound capability. Only the third preserves the established isolation boundary.

### Recommendation and API sketch

Provide an opt-in `sessionArtifactAdmission` helper alongside tool construction. It
uses `ctx.artifacts`, requires a real session when promising conversation scope, and
accepts an explicit exact-match kind allowlist and hard byte ceiling. Check metadata
before loading, then check returned metadata/data again because a head/get race or
custom store can disagree. Missing digests mean no integrity assurance; this helper
does not invent one. Preserve the existing store's digest-verifying `get` semantics.
An optional host `check` can only narrow admission and runs on every page. The helper
returns the admitted record to the existing viewer's decode/project path.
Before invoking `check`, detach and freeze the bounded admitted snapshot with the
existing `copyJson` owner, including metadata; pass that snapshot to the callback and
serve the same original snapshot afterward. TypeScript `readonly` alone cannot enforce
this rule. Mutation attempts, getters and replacement payloads cannot rewrite what the
host admitted. This ordinary-JSON helper does not implicitly admit binary payloads.

```ts
interface SessionArtifactAdmissionOptions {
  readonly kinds: readonly string[];
  readonly maxBytes: number; // positive safe integer, capped by the consuming reader
  readonly check?: (
    record: ArtifactRecord,
    context: ToolExecutionContext,
  ) => boolean | Promise<boolean>;
}
type SessionArtifactAdmission = (
  ref: ArtifactRef,
  context: ToolExecutionContext,
) => Promise<ArtifactRecord>;
type SessionArtifactAdmissionFactory = (
  options: SessionArtifactAdmissionOptions,
) => SessionArtifactAdmission;
```

This record-returning contract is proposed composition plumbing. Existing
`ArtifactDetailOptions.admit` callbacks that return JSON remain the supported manual
door; no guessed union of record and payload is added to it. The auto-mounted path
composes the helper and decoder internally. Apps with custom domain proofs can opt
into the helper before their own checks, or keep their existing stricter callback.
The library never substitutes the generic helper for an app's proof-chain checks.
The intended end state is one admitted-record contract, with the JSON-returning form
as a thin documented adapter over that contract, rather than two permanent admission
doors. Phase 1 keeps the existing manual callback contract intact; a later convergence
change must be explicitly reviewed, naming any breaking API change instead of adding
an indefinite compatibility shim.

For screens and host routes, reuse `standingAgent.artifactsForRequest` and its existing
verified session binding, revocation lifetime and operation budget. Do not export a
new "compose your scope" function. An open anonymous host offers scope isolation, not
authenticated ownership; deployments must retain their existing identity policy.

### Proof, exclusions and migration

Use a cross-tenant/principal/conversation matrix, including guessed valid refs, missing,
expired and deleted refs. Their public unavailable answers contain no distinguishing
metadata. Test missing session/store, empty or malformed allowlists, wrong kind, lying
sizes, head/get mismatch, digest failure, callback throw including a forged public
error, cancellation and a second page after permission revocation. Test that `check`
cannot widen kinds/size or replace the admitted payload. Verify host routes and model
tools resolve the same scope without a second identity composer.

This helper proves neither current-run origin nor producer identity, parent integrity,
domain correctness, source freshness or permission to assert a conclusion. The host app retains
its proof → finding → query checks on every page. Existing apps opt in and keep their
callbacks; there is no default admission change or compatibility alias.

## 3. Typed row pages over declared dataset snapshots

### Problem and options

JSON child pages are useful for proof trees, not selected columns and ordered rows.
`DatasetArtifactInput` declares publications, not a universal tabular schema. Options
are model-written queries, whole-object scans per page, or a typed view over an explicitly
declared saved rowset with bounded work. Recommend the typed view. Keep computation
above `ArtifactStore`; never add `query`/`transform` to that port.

### Recommendation and API sketch

Publish a dataset using `withDatasetArtifacts`/`stageDatasetArtifacts` and an explicit
column declaration. The producer chooses the row location, types, units, coverage and
time axis; the reader never guesses that an arbitrary array is a table. The optional
indexed representation for large tables is a manifest and immutable chunks under the
same refs, with parents and ordinary retention. Keep existing `dataset/rows` array
payloads unchanged. A separate view descriptor uses a new declared kind; mint the
source dataset first, its index second (parent: dataset), then the view descriptor
(parents: dataset and index). This avoids a parent cycle and creates no dangling
forward reference. The manifest exposes only visible
columns/rows and declares a saved ordinal. Source redaction precedes its construction.

```ts
type RowValue = string | number | boolean | null;
interface RowColumn {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly nullable: boolean;
  readonly unit?: string;
}
interface RowViewDeclaration {
  readonly sourceRef: ArtifactRef;
  readonly rowsPath: string; // existing shared JSON pointer grammar
  readonly columns: readonly RowColumn[];
  readonly indexRef?: ArtifactRef;
}
interface RowViewPublication {
  readonly kind: 'dataset/view';
  readonly declaration: RowViewDeclaration;
}
type RowFilter =
  | { readonly column: string; readonly op: 'eq' | 'ne'; readonly value: Exclude<RowValue, null> }
  | { readonly column: string; readonly op: 'lt' | 'lte' | 'gt' | 'gte'; readonly value: number }
  | { readonly column: string; readonly op: 'is-null' | 'is-not-null' };
interface RowPageRequest {
  readonly ref: ArtifactRef;
  readonly columns: readonly string[];
  readonly offset: number;
  readonly limit: number;
  readonly where?: readonly RowFilter[]; // conjunction only; bounded count
  readonly orderBy?: readonly {
    readonly column: string;
    readonly direction: 'asc' | 'desc';
  }[];
}
type RowPageResult =
  | {
      readonly status: 'page';
      readonly ref: ArtifactRef;
      readonly columns: readonly RowColumn[];
      readonly rows: readonly (readonly RowValue[])[];
      readonly offset: number;
      readonly total: number;
      readonly shown: number;
      readonly complete: boolean;
      readonly nextOffset?: number;
      readonly context?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: 'gap';
      readonly reason: 'scan-limit' | 'sort-limit' | 'index-unavailable' | 'value-too-large';
    };
interface RowReadLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxPredicates: number;
  readonly maxSortColumns: number;
  readonly maxScanRows: number;
  readonly maxScanBytes: number;
  readonly maxWorkingBytes: number;
  readonly maxOutputBytes: number;
}
```

The table reader shares admission/fixed-error ownership with section 2. It has a distinct
typed selector, not a second store or a general query engine. Effective limits are the
minimum of immutable library ceilings, host policy and caller request. The first model
surface keeps a small row cap (at most 20, further reduced by output bytes). A screen
may request a larger page only through explicitly approved host limits. Defaults and
benchmarks must be reviewed in the implementation; no unbounded default is permitted.
`RowViewPublication` is a proposed input to a library-owned publisher beside
`stageDatasetArtifacts`, not a manifest that every app writes differently. That owner
validates the declared source/row location/schema and publishes the documented
`dataset/view` representation. It validates any declared index as the matching complete
visible view; raw row data never chooses an executable index provider. The precise
chunk encoding is a later reviewed implementation detail of that single publisher.

Define semantics before implementing: column selection follows request order, names
are unique and schema-declared, no coercions or locale parsing; numeric comparisons
accept finite numbers, string equality is exact, `ne` on null is false and null tests
are explicit. Missing declared cells or wrong cell types invalidate the saved row view;
they are not silently converted to null or skipped. Sort strings by one specified
code-unit order, booleans false before true, numbers numerically; nulls last in both
directions. Code-unit ordering is deterministic, not human or locale collation; screens
must not describe it as alphabetical ordering. Break ties by saved visible
row ordinal. Without sorting, use saved ordinal order. Offset counts rows **after**
the complete filter/sort. `total` is the exact count of the authorized matched view,
`shown` equals returned rows, `complete` means no later matched rows, and `nextOffset`
is present only when more exist. No hidden/source-wide count is returned.
Bounded `context` carries the admitted snapshot's coverage, time-axis facts and
limitations, under the same output ceiling; it cannot overwrite navigation fields.

For small legacy snapshots, a whole read is allowed only below a declared byte ceiling;
scan and sort must finish within fixed work/memory budgets before any rows or total are
served. Over budget returns a gap with no rows, partial total or continuation. For large
tables, use a prebuilt admitted index/chunk manifest or first materialize a bounded
derived view. Indexes and derived views use existing refs and retention, are complete
before advertising, and never point into a live source. Unindexed expensive filters
are refused with a gap rather than rescanned without a bound. No regex, arbitrary
expressions, joins, aggregation, model SQL or executable predicates enter this API.

`codeRunnerTool` remains appropriate for heavier analysis over explicitly staged saved
inputs. Today's `wants`/`stageInputs` loads whole inputs; this design does not relabel it
as bounded paging. For generated code that needs incremental access, the host will stage
an optional run-bound **page client**, not store credentials or raw refs with authority.
Each callback crosses the same reader/admission and current-session check. A runner
without that capability reports absence; it cannot emulate it by preloading the data.
Full-file staging remains an explicitly separate analysis choice with its own budget.

```ts
interface CodeArtifactPages {
  rows(request: RowPageRequest): Promise<RowPageResult>;
  detail(request: ArtifactDetailArgs): Promise<ArtifactDetailResult>;
}
interface CodePageAccessAddition {
  readonly artifactPages?: CodeArtifactPages;
}
```

These are trusted host/runner capabilities, not fields generated code can forge. Their
lifetime is bounded to the authorized execution and revocation stops later callbacks.
Returned source strings remain data, never automatically evaluated code.

### Proof, exclusions and migration

Compare concatenated pages against a deterministic in-memory oracle for every supported
filter/sort/null case. Include equal sort keys, non-ASCII strings, empty matched views,
last/beyond-last offsets, oversized individual cells, schema mismatch and corrupt chunks.
Prove totals exact or absent on a gap, hard ceilings cannot be raised by model input,
scans stop within bounds and hidden columns/rows affect no public result or error.
Use a large lazy fixture to fail if a ranged path calls whole `get`. Test a generated
code page callback after revocation and an unsupported runner. Keep coverage/time-axis
declarations and existing dataset projection regression tests intact.

No table discovery, live-source pushdown, SQL execution or new database is proposed.
Existing dataset refs remain immutable and readable; only explicitly recognized saved
row representations receive row-page actions. Changing an application's row payload to
a manifest is a breaking producer/consumer contract and must be named and migrated
together, using newest versions only. Do not retain an old-format writer or shim.

## 4. Retain oversized cause answers only under explicit host policy

### Problem and options

The cause tools return a fixed truncated gap when the full answer cannot fit. Placement
cannot recover the detail after the cause response composer has discarded it. Options
are retaining every cause result automatically, asking the model to recompute it later,
or retaining the exact computed answer only with explicit host policy. Recommend the
last option, default off; keep the existing truncated-gap behavior when off.
The owners are `src/trace-toolpack/causeReader.ts` · `readCause` and
`src/trace-toolpack/causeResponse.ts` · `causeResponse`, `causeGap`.

### Recommendation and API sketch

The cause response boundary receives the complete computed answer once. Before discarding
oversized detail, an optional host retention capability serializes that exact answer
with the existing payload owner, saves it through the already-bound artifact capability,
and returns a ticket only after storage and a final liveness check. Do not rerun the graph
to mint detail: that can produce different evidence. Retain the **authorized/redacted**
answer, with the same graph scope and caveats as the short answer.
Retain only that already-computed finding/gaps/interpretation object; do not capture
the graph, raw record, samples or a second cause envelope.
The owner adopted this later-phase policy: use the **same artifact store and scope as
the conversation**, end retention with that session, cap lifetime at **24 hours from
mint**, and cap the retained payload at the viewer's **1 MiB** input ceiling. Retention
stays **off by default and enabled per app**. This policy decision does not authorize
phase 3 implementation now.

```ts
interface CauseRetentionPolicy {
  readonly ttlMs: number; // host-resolved remaining session lifetime, at most 24 hours
  readonly maxBytes: number; // positive safe integer, at most 1 MiB
}
interface RetainedCause {
  readonly ref: ArtifactRef;
  readonly expiresAt: number;
  readonly detail: ArtifactDetailAction;
}
type CauseRetentionResult =
  | { readonly status: 'stored'; readonly retained: RetainedCause }
  | { readonly status: 'unavailable' };
interface CauseRetention {
  readonly policy: CauseRetentionPolicy;
  retain(answer: unknown, signal?: AbortSignal): Promise<CauseRetentionResult>;
}
interface CauseRetentionAddition {
  readonly retention?: CauseRetention;
}
```

This optional capability belongs on the trace toolpack's existing cause wiring; it does
not expose a raw store or scope to model arguments. A library-provided binder should
implement it through `ToolArtifacts`, existing retention and the shared viewer. The
host owns the lifetime and size policy. The bound mint stamps available run/tool-call
origin; absent origin is stated, never invented. Proposed kind: `trace/cause`, exact
allowlist entry, `application/json`, digest requested at mint. Source artifact refs are
parents only when actually known and resolvable in that scope; graph node IDs are not
silently treated as artifact parents.

Require finite positive TTL and byte budget within the adopted caps when enabled.
Expiry is the earlier of the session's end and 24 hours from mint; store/source policy
can make it earlier. Reads never extend it. The later focused design must specify the
known-session-end and early-close cleanup contract before enabling retention; an unknown
session lifetime is not permission to retain indefinitely. Dependent manifests/chunks
cannot outlive that authorization/lifetime policy. Eviction, storage failure, no eligible
viewer, unsupported size or timeout yields the existing safe gap, with a fixed unavailable
retention status, no unusable action and no raw exception. Do not fall back to showing
the full answer inline. Cancellation cannot announce a reference that finishes minting
too late; a late write follows normal retention without becoming a delivered ticket.

The short answer must preserve the snapshot-capture limitation, uncertainty, alternatives
and physical-cause caveat. A detail link adds no support or claim authority. Complete
cause results larger than the bounded JSON viewer can accept require the indexed path
from section 5; until it exists, do not advertise them as pageable. A summary without
accessible detail is explicitly withheld proof, not a complete proof by implication.

### Proof, exclusions and migration

Test off means zero writes and byte-identical old output. When on, assert one graph
computation, exact retained answer, redacted content, origin, kind, digest, clamped TTL,
viewer admission on every page and no authority gain. Test quota eviction during mint,
missing parents, late completion, unavailable store, oversized serialization and a link
expiring between pages. Test the same conversation store/scope, early session end, the
24-hour cap and the 1 MiB cap. Foreign refs must give the ordinary missing response, without
counts or retention details. Test compact output at minimum host limits.

No always-on archive, automatic quota increase, permanent retention or recovery of
already discarded historic answers is proposed. Apps opt in through existing cause
options; old answers and gate behavior stay unchanged. **Adopted owner decision:**
retention follows the session/24-hour/1 MiB policy above. Keep implementation disabled
until the later focused design and app-specific configuration are approved.

## 5. Optional bounded range reads and paged screens

### Problem and options

A small response is not a bounded read if the store and screen first load a 500 MB object.
Streaming avoids buffering but does not provide random access or verify the whole digest.
Options are fake ranges by calling whole `get`, optional canonical-byte ranges, or a new
query store. Recommend optional byte ranges plus the saved indexes described in section 3.
Neither replaces the existing five verbs.

### Recommendation and API sketch

Add an optional `getRange` member to `ArtifactStore`, detected in the same style as
`canGetArtifactStream`. It reads canonical payload bytes, not envelope or base64 offsets.
Strict safe-integer offsets/counts, a fixed hard byte cap, and no negative/suffix/open-ended
ranges. Authenticate and admit before reading or describing size. An offset equal to
size returns an empty final range; an offset past size is invalid only for an admitted
artifact. No range-capable implementation may fetch/decode the whole object to answer.

```ts
interface ArtifactRangeRequest {
  readonly offset: number;
  readonly length: number;
  readonly expectedDigest?: string;
}
interface ArtifactRangeRecord {
  readonly meta: ArtifactMeta;
  readonly offset: number;
  readonly bytes: Uint8Array;
  readonly complete: boolean; // reached end of canonical bytes
  readonly integrity: 'not-verified';
}
type ArtifactRangeResult =
  | { readonly status: 'range'; readonly range: ArtifactRangeRecord }
  | { readonly status: 'unsupported' };
interface ArtifactRangeAddition {
  getRange?(
    scope: ArtifactScope,
    ref: ArtifactRef,
    request: ArtifactRangeRequest,
  ): Promise<ArtifactRangeResult | null>;
}
```

The expected digest is an optional consistency precondition against the admitted
version's metadata, not verification of returned bytes. It does **not** pin a physical
generation. A range-capable adapter must bind the ref to the original saved generation
at publication, keep that binding in its existing scoped storage metadata, and use that
same generation on every range. Binding only to whichever generation is current at
each read is insufficient. If the original cannot be read, return unavailable, never
fall back to the newest generation. No portable lease token is introduced. Old refs
or representations without a provable saved-generation binding return `unsupported`
**after** admission; missing/foreign/expired refs still return `null`. Do not leak support
or encoding metadata before admission. Cloud ETags/version tokens are adapter facts,
not portable content digests. A partial range cannot claim verification from a
full-object hash. Domains requiring verified evidence keep using verifying `get` within its bounds
until a separately reviewed authenticated chunk manifest exists. No weaker path is
selected silently for the host app's proofs.

| Adapter         | Initial range position                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory       | Absent. It already holds the whole payload; the capability must not imply bounded storage memory.                                                                                         |
| SQLite          | Absent until the driver offers a genuinely bounded canonical-byte read. Do not use whole BLOB reads behind a slice.                                                                       |
| File            | Candidate only for external canonical-byte payload files using bounded file reads. Embedded JSON envelopes remain unsupported unless a new saved representation is explicitly introduced. |
| S3 / GCS        | Candidates only with conditional bounded object reads, stable-generation binding and conformance evidence. Existing streaming alone proves none of this.                                  |
| Custom adapters | Advertise the member only after passing the same memory, generation, scope and failure laws.                                                                                              |

Bounds apply to **admission and metadata reads too**. Today
`src/artifacts/fileArtifacts.ts` · `readEnvelope` loads inline payloads even for `head`,
and `src/artifacts/sqliteArtifacts.ts` · `selectOne` selects the payload for the
metadata path. Their existing `head` cannot underpin a claimed large-object bound.
Files need separately readable metadata for the supported representation; SQLite must
first avoid selecting payloads and still needs genuine bounded byte access. Likewise,
file inline streaming and an SDK stream fallback that buffers the body cannot be
reused as a range implementation. Conformance must instrument these paths as well.

Byte ranges are an internal storage building block. They cannot split a JSON value,
UTF-8 string or identifier into a model-visible half. The JSON/row readers above the
store use a saved index and complete encoded units. Range support by itself does not
make arbitrary old JSON randomly pageable. Index/chunk formats belong with the existing
payload/publication owner; define one documented representation per view, not adapters'
private incompatible formats.

Extend `artifactWire.ts` and the existing wire-op list/readers for `artifact-range` and
typed page requests, preserving existing ownership, scope binding, fixed 404 and combined
per-session budget. Binary wire ranges need an explicit base64 encoding in the existing
reply envelope, with byte and transport-size caps including expansion. JSON and row page
wire replies carry the shared reader's result; browsers do not reimplement admission or
filtering. A store byte range remains internal unless host policy permits raw byte access.

In Lens, extend `ArtifactResolver` with optional `detail`/`rows` methods. Select a
paged renderer from admitted `head` metadata **before** calling `get`. Add an optional
paged component contract to the existing kind registry; keep ordinary small-value
components explicitly separate. `ArtifactRowsTable`'s current 200-row DOM slice and
`ArtifactMetaCard`'s text preview do not bound whole fetches or serialization.

```ts
interface ArtifactPageResolverAddition {
  detail?(request: ArtifactDetailArgs, signal?: AbortSignal): Promise<ArtifactDetailResult>;
  rows?(request: RowPageRequest, signal?: AbortSignal): Promise<RowPageResult>;
}
interface PagedArtifactComponentProps {
  readonly meta: ArtifactMeta;
  readonly resolver: ArtifactPageResolverAddition;
}
```

The resolver calls the authorized host on each page. Keep a bounded page cache keyed by
ref, selector and caller view; revalidate authorization before serving a cached page,
clear it on identity/session change, and ignore cancelled late responses. UI expansion,
sorting and filtering all use saved refs. Download/export is a separately authorized
bounded-stream action with a size policy, not an implicit `get`/Blob of the entire object.
If no page capability exists, show an explicit unsupported view for large objects.
Small legacy components may still use whole `get` only under a stated byte cap.
Lens `src/react/components/TimeAxisLine.tsx` · `TimeAxisLine` currently receives all
rows from the table. Its paged version must label facts as page-scoped, or use explicit
producer-computed whole-view facts; it cannot infer dataset-wide counts from one page.

### Proof, exclusions and migration

Extend store conformance with scope/expiry/delete races, offset edges, generation changes,
canonical-byte equality and output caps. Instrument physical reads and allocations on
large fixtures: no whole `get`, envelope load, concatenation or size-proportional memory
on range paths. Unsupported adapters have no member. Add Lens tests that throw if `get`
is called before choosing a paged renderer, paginate a huge fixture, revoke permission
between pages, switch identities, and verify no hidden counts/columns or late old pages
reach the screen. Assert deterministic data and instruction-like labels in model views.

No transparent fallback, database queries, live pagination or universal random access
is proposed. New optional store/resolver members are additive. Moving a component from
required whole `data` to paged props is an explicit renderer contract change: register
the paged mode and upgrade its consumer together, without pass-through shims. Older
saved artifacts remain untouched and honestly report unsupported range access.

## 6. Read consistency without a generic lease

### Problem and options

Hosts such as the host app verify a proof chain again for every page. Options are caching an
earlier approval, holding a cross-adapter read lease, or using conditional reads only
where a backend can bind one immutable generation. Neither a digest in `head` nor a
JavaScript frozen object proves that a later store read is unchanged. All current
adapters permit deletion/expiry, and durable objects can change outside the library.

### Recommendation and API sketch

**Drop the general lease from the initial API.** It cannot safely provide the requested
verification shortcut across today's adapters, and pinning data must not postpone
expiry, prevent owner deletion or override a revoked permission. Keep domain-chain
verification on every page. Section 5 requires an adapter's saved-generation binding
to prevent mixing versions. Its optional digest comparison alone cannot do that, and
neither mechanism authorizes a page or validates a changed parent.

```ts
// Proposed consistency input already carried by ArtifactRangeRequest.
interface ArtifactReadCondition {
  readonly expectedDigest?: string;
}
// Deliberately no ReadLease type, acquire method, renewal or cached authority token.
```

A future optimization needs a concrete adapter proof: atomic acquisition of the exact
artifact and dependency generations; immutable bytes and metadata; fresh current
permission and expiry checks per page; deletion/revocation behavior; bounded memory,
lifetime and concurrent holds; failure/crash cleanup. It must distinguish a retained
byte handle from authority to disclose it. If any condition cannot be enforced, the
optimization is absent. No model-visible lease token or new ref format is justified.

### Proof, exclusions and migration

Tests must mutate stored payload while leaving head metadata unchanged and change a
parent on digest-verifying/domain-chain paths: verification must refuse. Generation-bound
range tests must return the originally saved generation or unavailable, never mixed
bytes. Explicitly unverified paths cannot promise detection of every same-metadata
corruption; test their limited label and refusal to gain cached authority instead.
Delete or expire between pages, revoke admission, reuse a ref in another conversation
and cancel while a read is pending: these must refuse rather than serve cached-approved
data. A matching digest precondition never sets integrity to verified.
No persistent or cross-run verification cache is introduced, so no migration is required.

This deliberately does not speed up the host app's chain checks or promise data survival after
deletion. **Adopted owner decision: defer the generic lease.** Reopen it only for a named
backend and a precise, provable generation and deletion/expiry contract in a separately
reviewed design. A cross-adapter promise cannot be approved from synthetic behavior alone.

## 7. Record exact artifact use for Foottrace provenance

### Problem and options

`ArtifactEventFact.resolved` currently says ref/via/kind/bytes. A metadata lookup does
not mean the model or code received a value, and a whole `get` does not state which page
was delivered. Options are inferring use from reads, inventing an app provenance format,
or recording a precisely addressed delivered read and letting Foottrace translate it.
Recommend the last option, coordinated with the Foottrace owner.

### Recommendation and API sketch

Keep existing artifact events metadata-only. Add a bounded read receipt at the actual
page-delivery boundary, using existing run/step recording conventions. No receipt for
a mere `head`, failed admission, discarded late result or page never delivered. A code
page callback records delivery to that execution; a screen delivery is not attributed
to an agent reasoning step unless that relationship is actually known.

For a model reader, `artifactDetailTool.execute` returning is too early: governance,
placement, history/window transformations or another refusal can still withhold the
page. Bind use to the final provider-port request through the existing
`src/core/agent/stages/callLLM.ts` · `buildCallLLMStage` and
`src/core/agent/receipt/receipt.ts` · `buildReceipt` ownership. This proves the request
handed to the provider port, not vendor wire delivery or model consumption. An earlier
tool/source access may keep its own access fact; it is not an exact model-use fact.

```ts
type ArtifactReadSelector =
  | { readonly kind: 'json'; readonly request: ArtifactDetailArgs }
  | { readonly kind: 'rows'; readonly request: RowPageRequest }
  | { readonly kind: 'bytes'; readonly offset: number; readonly length: number };
interface ExactArtifactReadReceipt {
  readonly standing: 'exact-version';
  readonly ref: ArtifactRef;
  readonly scope: ArtifactScope; // protected trace only, never model/page payload
  readonly versionDigest: string;
  readonly pageDigest: string;
  readonly selector: ArtifactReadSelector;
  readonly viewRef?: ArtifactRef;
  readonly limits: {
    readonly maxOutputBytes: number;
    readonly maxItems: number;
  };
  readonly delivered: {
    readonly mode: 'value' | 'children' | 'rows' | 'bytes' | 'scalar-omitted';
    readonly shown: number;
    readonly complete: boolean;
  };
  readonly reader: {
    readonly kind: 'model' | 'code' | 'screen';
    readonly runId?: string; // agentfootprint event run ID, not a native log ID
    readonly toolCallId?: string;
    readonly runtimeStageId?: string;
    readonly sourcePosition?: EventSourcePosition; // existing event-coordinate owner
  };
}
```

This is a proposed receipt shape for owner review, not a new export format or an
already-supported event. Ref and digest together identify saved bytes in their scope;
page digest and the normalized selector identify what was actually delivered. The
receipt includes effective limits/view identity and the actual delivered selection,
not just the requested limit; `shown` counts children, rows, bytes or one whole value
according to mode, and zero for an omitted scalar.
Digest computation reuses `payload.ts`; it must not re-encode with a competing
canonicalizer. The proposed `ExactArtifactReadReceipt` is produced only when its
version digest has actually been verified and the full delivery binding is available.
A missing/unverified version digest produces **no exact receipt**; the existing
`ArtifactEventFact.resolved` remains a weaker access observation, without a fabricated
digest. Computing a page digest alone does not prove its source's integrity or truth.

Row selectors, pointers, scope and reader IDs can themselves be sensitive. Write
receipts only under the host's protected recording/redaction policy; omit or weaken an
exported relation when exact identity was redacted. Do not reconstruct hidden selectors
from payloads. Event `meta.runId` and footprintjs traversal run IDs are different
namespaces: correlate by the existing recorder/step binding, never string equality.
Reuse existing `src/events/types.ts` · `EventSourcePosition` through the event envelope's
`meta.sourcePosition` and `meta.runtimeStageId`, including native/child log coordinates.
The sketch shows the required binding, not a replacement coordinate format. Without
that native source position and an identified consumer step, no exact native step-use
edge may be emitted. `committedThroughIdx` names the committed prefix at emission,
not that event's eventual commit; never derive the consumer commit as "index plus one".

The intended standard relation is existing **`prov:used`**, not a new "AI evidence"
predicate. The Foottrace per-step translator owns whether that relation can be EXACT.
No generic listener can retroactively assign exact step use from arrival order.
The implementation must agree with `foottrace/prov` and its per-step translator before
emitting this extension; this design does not add PROV vocabulary or a graph walker.
At the inspected Foottrace revision, `src/prov.ts` exports `exportProv`,
`ProvExportRefusal` and public data types. `src/lib/prov/translateCommit.ts` ·
`translateCommit` and `src/lib/prov/translation.ts` · `ProvCommitContext` are internal,
not an available public plugin seam. `admitProvRecord` does not consume artifact
events, and ordinary `mapReads` deliberately withholds version-specific `prov:used`.
Section 7 therefore needs coordinated Foottrace admission/mapping work; agentfootprint
cannot achieve it by attaching a callback to a public translator today.
This is approved direction only. Start its focused design jointly with Foottrace after
[footPrint #113](https://github.com/footprintjs/footPrint/issues/113), which addresses
exact read versions; it is not part of the phase 1 implementation approval.

### Proof, exclusions and migration

With the Foottrace owner, test one admitted, verified page actually included in a
provider-port request yields one exact use of its identified version by the right
consumer step. A page created but replaced, placed, window-evicted or withheld before
the next provider request yields no exact model-use receipt. Metadata-only, failed,
cancelled and unsent reads yield none. Test repeated pages and multiple code/screen readers without accidental
merges, cross-conversation export redaction, selector/page digest mismatch, absent source
digest, packed recordings and parallel step IDs. Reuse the standard PROV conformance
and per-step translation tests instead of adding an app-specific exporter.

This is an evidence-of-use link, not physical cause, source authenticity, claim approval
or proof that a person understood a screen. Adding receipt/event fields is additive only
if the existing record readers accept that extension; otherwise name and coordinate a
record-format breaking change. Use newest compatible library versions together; do not
keep a second translator for old and new app-specific records.

Questions for Foottrace: what is the supported per-step attachment contract, how does it
identify immutable versions/page entities, what qualifies as EXACT when a source digest
is absent or redacted, how is protected scope encoded injectively without leaking it,
and how should actual code/screen delivery be represented without inventing an agent
step? Resolve those before implementation.

## Review gates and implementation order

The owner approved the design in principle and **only phase 1 for implementation now**.
Merging this note does not approve code for the later phases. Their sketches are
direction, and each needs a short focused design and owner approval when a real need arrives.

1. **Placed JSON and conversation admission (sections 1–2).** Preserve old bytes and
   opt-in behavior; prove every-page isolation, bounded parse, usable ticket actions and
   unchanged defaults. The instruction-like-label provider-boundary regression is
   required in this phase. Do not promise large-object random access yet.
2. **Typed row pages (section 3), direction only.** When a real table need exists, first
   write the focused design; the first adopter's dataset panel is a likely need.
   Agree schema, comparator/null semantics and budgets;
   prove exact totals or explicit gaps. Add runner page access only where its host can
   support per-page admission; keep whole-file analysis explicit.
3. **Optional retained cause answers (section 4), policy adopted, implementation deferred.**
   A short focused design must apply the conversation/session/24-hour/1 MiB policy
   before code. Keep off by default per app and preserve all uncertainty.
4. **Storage/screen pages and consistency decision (sections 5–6), direction only.**
   Measure real artifact sizes first: the largest known first-adopter proofs are at
   most 512 KiB, below the 1 MiB viewer limit. Then write the focused design. Prove genuine
   adapter bounds and saved indexes before advertising large paged rendering. Initial
   recommendation is no general read lease; every page remains freshly admitted.
5. **Exact read provenance (section 7), direction only, with Foottrace after footPrint #113.**
   Write the focused design and approve the recorder/translator seam and privacy rules
   together. No invented PROV terms or inferred authority.

Each phase has a separate reviewed implementation PR with failing-first tests, public
door/type checks, runnable examples and a change fragment where source changes require
one. Library changes land before app adoption. No bundled unpublished builds, duplicate
stores/viewers, compatibility shims or automatic migrations of saved payloads.

The owner adopted the later oversized-cause retention policy and the generic-lease
deferral. Those decisions do not enable either feature. API names and other numeric
defaults remain proposed until their phase's focused review; only phase 1 is approved
for implementation now.
