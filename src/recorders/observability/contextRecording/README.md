# Context recording

This library captures the context assembled at each logical model call, then
formats a saved run using an injected value-table writer. It does not change
the provider request, claim provider acceptance, or infer calls from slot order.

`recordContextRun(runner, createValueTable({ redact: value => value }))` requests
the source-time frame before the run. The native run has already served every
field under its redaction policy; the table adapter preserves that served
value. Use a fresh table per recorder. `await recorder.toRecording()` waits for
ids and produces the foottrace value-record envelope. `readContextRecording`
takes foottrace's `readValueRecord` as its reader adapter.

## Responsibilities

| Unit | Job |
| --- | --- |
| `../contextRecording.ts` | subscription lifetime, explicit member capture, public facade |
| `write.ts` | detach the captured wire record; intern complete text/schema values and encode explicit positions |
| `changes.ts` | duplicate-preserving deltas and permutations, keyed by native run and mount path |
| `read.ts`, `json.ts` | own bounded JSON before resolving declared positions; refuse malformed, overlapping or dangling references |
| `commentary.ts` | one sentence from each call's delta and source counts |
| `chart.ts` | attempt → recorded decision → complete or refuse; wiring only |
| stage folders | one formatter stage each; record contents stay in a private result cell, outside chart scope |

The saved `calls` list replaces the ephemeral `context.recorded` timeline
frames. Other typed events retain their order and values, including injection
details. `referencePaths` names exactly where a `{ref: id}` is a reference;
literal reference-shaped user data is never interpreted. Resolving a stored
value does not recursively reinterpret it. Text is preserved exactly; schemas
retain their JSON values. An equal schema's property order is not an identity.

The first retained call for each native run/mount lists all its ids. Later
calls carry added/removed ids and an unchanged count. Duplicate occurrences
count separately. A permutation is present only when needed to recover order.
Sibling mounts share an outer run id, so their source-provided subflow paths
are part of the key. No run-id spelling or selected/latest runner is consulted.

## Limits and failures

Source frames are detached and frozen before native emit, with an 8 MiB per-call JSON bound. A non-JSON or oversized frame records an omission and refuses export; it never changes provider inputs. The frame bridge stays inline even under deferred public observers.

The existing event tail still owns capture/drop limits. Drops and the retained
window offset travel in the body. The table owns admission, hashing and storage
limits. An omitted table value refuses the export (`value-omitted`); it is never
silently copied inline. A retained model-start event without its matching
source frame refuses with `capture-unavailable`. A complete new record cannot
claim unchanged context where capture was missing.

The reader uses a conservative 64 MiB work/expansion budget, 200,000 JSON nodes,
depth 100, 100,000 reference paths and 10,000 calls. It rejects accessors and
non-JSON data, and owns values before use. Proxy traps can run while an input is
being inspected; a hostile trap that never returns needs host isolation.
Old records pass through by identity without reference interpretation.

An exact subscription to the content event enables additional sensitive prompt
material for that instance and its explicitly named members for the subscription's
lifetime. Wildcard sinks alone do not enable it. Once enabled, all sinks receive
the same served event. This is not a new session authorization boundary or a
whole-record redaction policy. A custom table adapter must honor the port's
already-served-value contract; adapter errors are replaced by fixed refusals.

The new public capability is opt-in. Ordinary `recordRun`, its synchronous
export, the existing packed format, and provider request bytes keep their
contracts. New native context frames are collected during traversal, not
reconstructed from a finished execution tree.

For a composition, pass `{ members: [firstAgent, secondAgent] }`. These are
explicit content-capture grants for the mounted instances. Recording never
invokes a UI translator to discover members. Omitting a called member refuses
the export with `capture-unavailable`; it cannot silently claim an empty offer.
