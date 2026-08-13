# src/artifacts — the claim-check store

**One job:** let a tool check a payload into a governed store and hand the
model a ~26-char claim ticket (`art_…`), so data stops riding the
conversation. The model routes tickets; a later tool redeems them under the
run's own scope. Phase 1 of the reference architecture: THE STORE — the port,
three adapters, the `ctx.artifacts` capability, and the typed events. (Ref
tool-args at dispatch, the `present` tool, the placement threshold, FE
rendering and typed HITL are later phases and deliberately absent.)

## The laws (each has one owner)

| module | owns |
|---|---|
| `types.ts` | the shapes + the **five-verb port** (`put · head · get · delete · list`; scope is ALWAYS the first argument — the MemoryStore constitution) and the refusal errors. The port never grows `query()`/`transform()`: compute belongs to the code leg, and that refusal is written down so it can be cited. |
| `naming.ts` | the ref grammar (`art_` + 22 base62). Minted, never content-addressed — the digest is metadata, never the key. Nothing else may parse or fabricate refs. |
| `payload.ts` | how a payload is measured (`bytes`), carried durably (one envelope for file + sqlite), and digested (`sha-256` over the same canonical bytes). Unserializable payloads are refused by name, never approximated. |
| `retention.ts` | the eviction law: ttl / max-bytes / max-count per scope, planned as a pure function all three adapters call. Every eviction is a returned FACT; expiry is STATED via `expiresAt` at mint, never sprung. |
| `minting.ts` | the shared half of every `put`: validate, prove `parentRefs` resolve in the same scope (a foreign key that cannot dangle at birth), measure, digest, mint, stamp. |
| `inMemoryArtifacts.ts` | Map-backed; ALWAYS bounded + drop-counting (the innerRunRecords laws); LRU eviction, reads refresh recency. |
| `fileArtifacts.ts` | directory-backed; scope-partitioned percent-encoded paths (structurally traversal-proof, asserted anyway); one legible JSON envelope per artifact; budget evictions oldest-first (stated — a directory has no cheap read-recency). |
| `sqliteArtifacts.ts` | one SQLite file, `sqliteSessions` law for law (lazy `node:sqlite`, WAL read-back, STRICT tables, schema-identity/version refusals, `':memory:'` refused). The durable pairing beside `sqliteSessions`. |
| `capability.ts` | `ctx.artifacts` — the five verbs with scope PRE-BOUND by the framework (a tool can never widen it), fail-closed when no store is attached (`unconfiguredCredentialProvider` law), reporting facts to a neutral sink. |

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
