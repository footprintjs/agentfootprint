# Standing agent module map

This change splits only `src/hosting/standingAgent.ts`, measured at 2,380 lines
on base `f638c65cfb90c1ab0da1e09f020aed44e4cd51ff`. It preserves the hosting
door, its public types, all reply shapes and the order of its effects.

## Responsibilities and imports before the split

The current composition root also implements option validation, per-session
instance retention, FIFO serialization, request admission, session history,
artifact redemption and binding, pause/resume, terminal persistence, artifact
handover, failure attribution and shutdown. The same lexical scope holds the
pool, shared lane, retirement set, reader, artifact-operation counters and
closing promise. That shared scope is the tangle: a read-only artifact request
must borrow a live instance without creating a lane, while both artifact and
turn work prevent that instance from being evicted.

Its dependencies cross the hosting, artifact, event, runner, memory-identity
and tool-input contracts. Runtime runner access stays through the existing
private `runnerLive`/hosted-turn port. This split adds no upstream mechanism,
public export, compatibility alias or dependency.

## Module ownership after the split

| Module under `src/hosting/standingAgent/` | Whole units it owns | Rule |
| --- | --- | --- |
| `configuration/read.ts` | Original construction checks and option defaults | Refuse the same invalid configuration, in the same order, before serving. |
| `lane.ts` | Existing `Lane` interface | One shared vocabulary for a held hosted invocation. |
| `lanes/pool.ts`, `lanes/keys.ts` | Lane creation, pool selection, factory checks, retirement, serialization, reader lookup | Never evict admitted work; never create a lane to redeem an artifact; preserve FIFO and namespace separation. |
| `requests/handler.ts` | Existing request handler and ingress funnel | Verify once, route history/artifacts without turn admission, then admit and serialize a turn. |
| `sessions/history.ts` | Session history and existing ownership predicate | Missing, foreign and ownerless sessions keep their existing refusal shapes. |
| `artifacts/access.ts` | Stored-envelope readers, redemption ownership and request binding | Share the original ownership, revocation and operation-budget state across both artifact doors. |
| `artifacts/wire.ts` | Artifact wire handling and answer-account branch | Preserve ownership, budget, silent-head, cache and event ordering. |
| `turn/run.ts`, `turn/port.ts` | Turn execution, pause/resume, persistence/delivery and runner-port check | Preserve every existing await and the invocation captured for persistence and handover. |
| `identity/request.ts` | Request identity, session artifact scope and header readers | Keep one identity/scope composition; repeated credentials remain ambiguous. |
| `artifacts/handOver.ts`, `artifacts/facts.ts` | Bounded handover and artifact fact/failure projection | A failed handover never changes the terminal, and its facts retain captured attribution. |

Every extracted folder has a README and adjacent behavior tests. The original
file remains the documented public facade and composition/shutdown wiring.
Every source file must be at most 600 lines; no baseline is raised.

## Closure and ordering constraints

Factories receive the existing stable collaborators and shared collections;
they do not reconstruct policies, identities, stores or agents. Cross-module
calls are wired by the facade, avoiding runtime import cycles. Mutable closing
state is read through a deferred accessor at the original read points, not
snapshotted during construction. The lazily created artifact reader is read
at shutdown, not captured before its first use.

No factory adds an async wrapper to an existing request, turn, serialization
or terminal function. Existing function bodies and comments move as whole
units, with only the dependency bindings/import paths needed by extraction.
Construction side effects, initial shared-lane creation, host-refusal
subscription, host serving and shutdown initialization retain their order.

## Validation

Existing hosting, admission, identity, artifact, pause/resume and shutdown
tests retain their assertions and goldens. Adjacent tests cover the moved
units and the ordering/captured-state boundaries above. Full lint, compiler,
build, tests, generated docs, docs truth, layering and file-size checks run
through ordinary hosted CI. Source path readers and citations are swept for
moved private symbols before exact-head review. This is a structure change
(steps 1–3), requiring behavior review rather than a token-identity shortcut
for the whole change. No release or merge is part of this task.
