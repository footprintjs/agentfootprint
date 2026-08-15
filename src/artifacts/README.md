# src/artifacts — the claim-check store

**One job:** let a tool check a payload into a governed store and hand the
model a ~26-char claim ticket (`art_…`), so data stops riding the
conversation. The model routes tickets; a later tool redeems them under the
run's own scope. Phase 1 (9.21.0) shipped THE STORE — the port, three
adapters, the `ctx.artifacts` capability, the typed events. Phase 2 (9.22.0)
ships THE DATA LEGS — ref arguments at dispatch (`wants`), the `present`
tool, the placement threshold, and the store behind `CodeResult.artifacts`.
Phase 5 (9.25.0) closes the reference architecture: THE CLOUD COLUMNS
(`s3Artifacts`, `gcsArtifacts` — same port, somebody else's bucket) and the
OPTIONAL STREAMING LEG (`putStream`/`getStream`, feature-detected, absent
where a store cannot honor them). (The component registry that validates
`as` and staging refs INTO code sessions remain later phases.)

## The laws (each has one owner)

| module | owns |
|---|---|
| `types.ts` | the shapes + the **five-verb port** (`put · head · get · delete · list`; scope is ALWAYS the first argument — the MemoryStore constitution) and the refusal errors. The port never grows `query()`/`transform()`: compute belongs to the code leg, and that refusal is written down so it can be cited. |
| `naming.ts` | the ref grammar (`art_` + 22 base62). Minted, never content-addressed — the digest is metadata, never the key. Nothing else may parse or fabricate refs. |
| `payload.ts` | how a payload is measured (`bytes`), carried durably (one envelope for file + sqlite), and digested (`sha-256` over the same canonical bytes). Unserializable payloads are refused by name, never approximated. |
| `retention.ts` | the eviction law: ttl / max-bytes / max-count per scope, planned as a pure function every adapter calls. Every eviction is a returned FACT; expiry is STATED via `expiresAt` at mint, never sprung. |
| `minting.ts` | the shared half of every `put`: validate, prove `parentRefs` resolve in the same scope (a foreign key that cannot dangle at birth), measure, digest, mint, stamp. |
| `inMemoryArtifacts.ts` | Map-backed; ALWAYS bounded + drop-counting (the innerRunRecords laws); LRU eviction, reads refresh recency. |
| `fileArtifacts.ts` | directory-backed; scope-partitioned percent-encoded paths (structurally traversal-proof, asserted anyway); one legible JSON envelope per artifact; budget evictions oldest-first (stated — a directory has no cheap read-recency). |
| `sqliteArtifacts.ts` | one SQLite file, `sqliteSessions` law for law (lazy `node:sqlite`, WAL read-back, STRICT tables, schema-identity/version refusals, `':memory:'` refused). The durable pairing beside `sqliteSessions`. |
| `scopePath.ts` | the ONE owner of "a scope becomes path segments" — the percent-encoding law the directory adapter first stated (encode per FIELD, dots encoded too so `'..'` is a NAME, empty collapses to `_`), now SHARED with both object columns rather than copied. Also validates an operator-supplied key root at construction. |
| `objectStore.ts` | the half both REMOTE OBJECT adapters share, and the only place their five laws live: payload as the object body's canonical bytes (never a base64 envelope — which is what makes `getStream` possible at all), the ticket as ONE ASCII-JSON metadata entry, the metadata budget checked and refused by name, missing-means-null-everything-else-means-error (and `NotFoundMeaning`, which makes each call site say whether it asked about one object at all — because a not-found from a write or a listing is not "no data", and letting it past the sanitizer hands the caller the SDK's text, which contains the key), and service-time ordering with an offset cursor. Imports no SDK and names no vendor. |
| `s3Artifacts.ts` | the S3 column: five commands (`PutObject`/`GetObject`/`HeadObject`/`DeleteObject`/`ListObjectsV2`), 2 KB metadata cap, a listing that costs one HeadObject per row RETURNED (the service never returns user metadata on a listing), native streaming via the SDK's response-stream mixin. Lazy peer dep at CONSTRUCTION. |
| `gcsArtifacts.ts` | the Cloud Storage column: the factory chain (`bucket.file().save/download/getMetadata/delete`, `bucket.getFiles`), 8 KiB nested custom metadata, a listing that reads a whole page of tickets in ONE call (this client populates `.metadata` on every listed File), native streaming bridged from Node streams at the adapter edge. Lazy peer dep at CONSTRUCTION. |
| `streaming.ts` | the OPTIONAL leg and how to ask for it: the narrowing guards (`canPutArtifactStream`/`canGetArtifactStream`/`canStreamArtifacts`), the streaming store types, and the shared helpers. Owns the STATEMENT of which adapters stream and why the others must stay ABSENT rather than fake it — a `Map`-backed store "streaming" bytes it already holds is theatre, and a consumer that chose it to bound memory would have been told a falsehood in the shape of a capability. |
| `conformance/` | the battery a store must pass to CLAIM the port — one definition of the laws, run against all five in-tree stores and exported for stores nobody here has written. Imports no test framework (a case throws to fail), so it runs under any runner or none. Three distinct non-pass outcomes (`not-applicable` for an absent OPTIONAL member, `declared` by name with a reason and STILL RUN, `failed` — including "needed a harness hook nobody supplied"), and no way to make a case quietly disappear. See `conformance/README.md`. |
| `capability.ts` | `ctx.artifacts` — the five verbs with scope PRE-BOUND by the framework (a tool can never widen it), fail-closed when no store is attached (`unconfiguredCredentialProvider` law), reporting facts to a neutral sink. Also owns the event vocabularies: `ArtifactOp` gained `'dispatch'` (the framework's own door — wants/present refusals at dispatch) and `ArtifactRefusalReason` gained `'kind-mismatch'` in 9.22.0. |
| `wants.ts` | ref ARGUMENTS at dispatch (Leg 1): `assertToolWants` (defineTool-time — a wants-arg must exist in `inputSchema.properties` as a string), `resolveToolWants` (the one resolver every dispatch door calls BEFORE credentials: get under scope, kind-check exact-match, ALL args judged before answering), and the teaching refusals that list the LIVE refs of the wanted kind (the innerRunRecords law — correct by naming what CAN resolve; listing bounded at 10 shown / 200 scanned). An ABSENT argument is judged by the tool's OWN `inputSchema.required` — required means refuse by name, anything else means the model legitimately chose not to pass one — read here rather than left to `toolArgValidation`, which is an agent-wide dial an operator can switch off. `wantsNeedsStoreRefusal` serves doors that meet the tool only at dispatch; the Agent refuses static wants-tools with no store at BUILD. |
| `present.ts` | the hand-to-the-screen verb (Leg 2), PURE half: `PRESENT_TOOL_NAME`, `presentArtifact` (head — never get — under scope; miss = teaching refusal listing live refs), and the `PresentedResult`/`PresentSnapshot` shapes. The result the model reads IS the description snapshot (`{presented, ref, as, snapshot:{kind, mediaType, bytes, label}}` as JSON), so a reloaded transcript re-draws the pane or states honestly why it can't. `as` is stored as DATA — the component registry that would validate it is Phase 3. The tool SHELL (placeholder the stage overwrites — the skip_step pattern) is `core/agent/presentTool.ts`; the stage emits `artifacts.presented`. |
| `recordingArtifact.ts` | recordings as artifacts (9.26.0), PURE half: `RECORDING_ARTIFACT_KIND` (`'recording/run'`), `RECORDING_MEDIA_TYPE`, and `recordingPutInput(recording, facts)` — the `PutArtifactInput` that stores one completed run's `{ snapshot, events, structure }`. The payload is the recording's JSON **text**, not the live object: `recordRun` states that `snapshot`/`structure` are the runner's own objects held by reference, and an in-process store handed those would keep a live view into a finished run. A recording JSON cannot carry is refused here (`UnserializableRecordingError`) rather than at whatever reads it. The Agent owns WHEN (after the answer is composed, awaited, failure contained) — this file owns WHAT. |
| `placement.ts` | the placement threshold (Leg 3), PURE half: the `ArtifactPlacement` dial (`{ maxInlineChars }` on the object form `Agent.create({ artifacts: { store, placement } })` — placement cannot be SPELLED without a store), `placedResultKind` = `tool-result/<toolName>` (the honest kind vocabulary a consumer wants or presents), and `placedToolResult` — the ONE-shape substitute (`{placed: true, ref, kind, mediaType, bytes, reason}`, the TruncatedToolResult law). Precedence, stated once: tool `resultCeiling` FIRST (author's refusal), placement second (operator's ref-ing, judged on what the after-tool chain let through), `maxToolResultChars` truncation net LAST (then measures the ticket). The stored payload is the EXACT text the model would have read. A placed result is a ticket, not a refusal: effects are judged and steps advance. |

## Import direction

`artifacts/` imports **only** `lib/` (lazyRequire, sqliteUnavailable) and
`memory/identity/` (the ONE scoping tuple — `ArtifactScope` *is*
`MemoryIdentity`, aliased, so two spellings of one isolation rule cannot
drift). It never imports `core/`, `events/`, or any recorder: the
tool-dispatch layer (`core/agent/stages/toolCalls.ts`) binds the capability,
composes the scope from the run's `runIdentity`, and adapts the fact sink
onto the typed `agentfootprint.artifacts.*` events. Core wires artifacts;
never the reverse.

## Decisions worth remembering

- **Scope** = the run's `runIdentity` tuple (`tenant?/principal?/conversationId`):
  an anonymous run scopes to its own runId, a session-bound run to its
  sessionId, an identity-carrying run to the caller's tenant/principal. A ref
  alone opens nothing; a wrong scope reads as "no data", never as a leak.
- **`get`/`head` return `null` for missing-OR-expired** (the memory
  precedent's deliberate ambiguity). The RECORD still tells the truth: a miss
  lands as `artifacts.refused { reason: 'missing-or-expired' }`.
- **Zero-cost when unused**: no store attached ⇒ byte-identical behavior and
  events; `ctx.artifacts` exists but refuses teachingly, `ctx.hasArtifacts`
  is the branchable fact.
- **No snapshot coupling** (Phase 1): `getSnapshot()` is unchanged; the
  store's own accounting is `list` + the adapters' counters. Stated here so
  the absence reads as a decision, not an omission.
- **Events carry meta only** — payload bytes never enter an event, a
  recorder, or an exporter.

## Phase-2 decisions worth remembering (9.22.0)

- **`wants` resolution order**: permission → middleware → arg validation
  (judges the REF string the model spoke) → check-in (a human approves the
  ticket, never 6 MB of evidence) → **wants** (never acquire credentials for
  a call that won't run) → credentials → execute. Same law at every door:
  the batch loop, all four resume paths (via `resolveCredentialAndExecute`),
  and `mcpServe` (which refuses wants-tools by name — no store there).
- **Kind check is exact string equality.** No wildcards, no hierarchy in
  this phase; `'dataset/rows'` matches only `'dataset/rows'`.
- **`ctx.wanted` is absent when nothing resolved** — absent and empty are
  different facts. A DECLARED argument the model omitted is judged by the
  tool's own schema: `required` there ⇒ dispatch refuses by name (the tool is
  never handed an argument it believes was resolved); otherwise the call runs
  and `ctx.wanted` simply has no entry for it.
- **Placement moves what routing predicates read.** The ticket replaces the
  result string everywhere downstream — history, `lastToolResult`,
  `toolResults` — which is where skill-graph `when` edges and `rule` triggers
  look. Deliberate (routing judges what the model was told), stated at both
  ends: `placeResults` in core/agent/stages/toolCalls.ts and
  `InjectionContext.lastToolResult`.
- **`present` misses set `error: true`** on the call: the model holds no
  presentation, `tool_end` says so, and a procedure step whose tool
  presented nothing does not advance. A PLACED result is the opposite — a
  ticket, not a refusal — so placement never touches those flags.
- **Placement judges the MODEL channel** (post-chain). When both channels
  carry one value — the common case — both become the ticket, so an event
  sink is never shipped the payload the window was spared. A
  chain-transformed `result` keeps its own truth and meets the truncation
  net as before. A `put` the store refuses (whole-budget overflow) falls
  back to today's path, stated on the record + a dev warn — never a throw
  out of a run whose tool succeeded.
- **The code leg mints ON OUTPUT only** (Leg 4). `CodeResult.artifacts`
  entries additively gained `mediaType? / data? / ref?`; `codeRunnerTool`
  mints entries that carry `data` in-band (kind `file/<ext>` from the
  producer's own filename, mediaType from the adapter's statement, a
  well-known-extension table, or the payload's JS shape) and the rendered
  line names the ref. **Staging-in is deliberately absent, stated:** the
  `CodeSession` port's only input is the code string, and pushing megabytes
  through `python3 -c` argv would hit OS argument limits in
  language-specific quoting — declared input refs for code wait for a
  session file-write verb on the port.
