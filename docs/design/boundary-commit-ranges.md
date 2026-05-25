# BoundaryRecorder commit ranges — Phase 5 Layer 2 design

Last revised: Phase 5 Layer 2 of v5 migration.

Builds on Phase 5 Layer 1 (footprintjs's `CommitRangeIndex<TLabel>` +
`executor.getCommitCount()`).

Read in conjunction with:
- `footprintjs/docs/design/commit-range-index.md` — the primitive
- `agentfootprint/CLAUDE.md` Convention 1 — one purpose per recorder
- `agentfootprint-lens/docs/design/lens-snapshot-recorder.md` — the
  consumer pattern that drove the architecture

---

## 1. What this layer adds

Two purely-additive enhancements to `BoundaryRecorder`:

1. **Per-event commit indices.** Every `DomainEvent` produced by
   BoundaryRecorder gains two fields:
     - `commitIdxBefore: number` — commit count at the moment the event
       fires, BEFORE any effects it carries.
     - `commitIdxAfter: number` — commit count immediately after.
   For most events these are equal (events don't write to scope). For
   subflow.exit / run.exit they may differ if the closing stage flushed
   commits in the same tick.

2. **Internal CommitRangeIndex.** BoundaryRecorder builds an internal
   `CommitRangeIndex<DomainBoundaryEntry>` keyed on `runtimeStageId`.
   Boundary entries `open()` the range; matching exits `close()` it.
   Consumers read it via `recorder.boundaryIndex`.

No existing field changes. No existing event removed. All consumers
(OTel exporters, custom dashboards, Lens) keep working unchanged. The
new fields and `boundaryIndex` are additive.

---

## 2. Two laws

### Law 1 — same commit-count source for both endpoints

The commit count is sampled from `executor.getCommitCount()` AT THE
MOMENT each event fires. There is no batching, no clock-of-last-event
trick. This makes the values monotonically non-decreasing and aligned
with the snapshot's commit log.

`commitIdxBefore` is recorded BEFORE running any per-event side effect.
`commitIdxAfter` is recorded AFTER the side effect (e.g., pushing to
the internal store + opening/closing the range index). For pass-through
events (no write), they are equal.

### Law 2 — runId guards reset the index

Phase 2 introduced `observeRunId` to wipe per-recorder state when a
new run starts (multi-run aliasing fix). Layer 2 extends this: on
detected runId change, BoundaryRecorder also calls
`this.boundaryIndex.clear()` so stale ranges from the previous run
can't pollute the new one. Phase 5 Layer 1's owner-symbol rotation
inside `CommitRangeIndex.clear()` invalidates any stale tokens
consumers might still hold.

---

## 3. Wiring contract

### Constructor — getCommitCount injection

```ts
const boundary = new BoundaryRecorder({
  id: 'boundary',
  getCommitCount: () => executor.getCommitCount(),
});
```

The callback is OPTIONAL. If omitted, `commitIdxBefore` /
`commitIdxAfter` default to `0` on every event (no-op for consumers
that don't care about ranges; preserves backward compatibility).

The owning runner injects the callback automatically:

```ts
// In RunnerBase or each concrete runner that constructs the executor:
const boundary = boundaryRecorder({
  getCommitCount: () => this.lastExecutor?.getCommitCount() ?? 0,
});
```

### Per-event sampling — both bounds

```ts
onSubflowEntry(event: FlowSubflowEvent): void {
  this.observeRunId(event.traversalContext?.runId);
  const commitIdxBefore = this.getCommitCount();
  const e = buildSubflowEvent(event, 'subflow.entry', commitIdxBefore);
  if (e) {
    this.store.push(e);
    // Open a range. Token stored in a side map keyed by runtimeStageId
    // for close-on-exit retrieval.
    const token = this.boundaryIndex.open(e, commitIdxBefore);
    this.openTokens.set(e.runtimeStageId, token);
  }
  // commitIdxAfter is sampled AFTER store push + index open
  // because those operations are pure-state in BoundaryRecorder, not
  // engine writes — so they don't change executor.getCommitCount().
  // We sample and stamp anyway for symmetry; consumers compare them.
}

onSubflowExit(event: FlowSubflowEvent): void {
  this.observeRunId(event.traversalContext?.runId);
  const commitIdxBefore = this.getCommitCount();
  const e = buildSubflowEvent(event, 'subflow.exit', commitIdxBefore);
  if (e) {
    this.store.push(e);
    // Close the range. The boundary RANGE on the commit log is
    // [entry.commitIdxBefore, exit.commitIdxBefore].
    const token = this.openTokens.get(e.runtimeStageId);
    if (token) {
      this.boundaryIndex.close(token, commitIdxBefore);
      this.openTokens.delete(e.runtimeStageId);
    }
  }
}
```

### Per-event behavior table

| Hook | Stamps commitIdx? | Opens range? | Closes range? | Notes |
|---|---|---|---|---|
| `onRunStart` | yes | YES (run-root) | — | Range closed by `onRunEnd` |
| `onRunEnd` | yes | — | YES (run-root) | Range close happens BEFORE store.push to avoid leak on push failure |
| `onSubflowEntry` | yes | YES (per subflow) | — | Range closed by matching `onSubflowExit` |
| `onSubflowExit` | yes | — | YES | Close-before-push, same as run end |
| `onFork` | yes | NO | NO | Emits N `fork.branch` events. Children's `onSubflowEntry` opens THEIR ranges. The fork itself is instantaneous; no separate range needed. |
| `onDecision` | yes | NO | NO | Zero-width event; rationale is captured in the event payload, not a range. |
| `onLoop` | yes | NO | NO | Loop back-edge is instantaneous. The loop BODY is captured by repeated `onSubflowEntry`/`onSubflowExit` of the body subflow. |
| `ingestTypedEvent` | yes | NO | NO | LLM/tool/context events decorate scope; the surrounding subflow's range encloses them. |

---

## 4. New public API surface

```ts
class BoundaryRecorder implements CombinedRecorder {
  // EXISTING — unchanged:
  readonly id: string;
  // ... methods ...

  // NEW — Phase 5 Layer 2:
  /** Internal CommitRangeIndex keyed on DomainEvent (the entry event).
   *  Consumers query enclosing()/overlapping() to get the boundary
   *  breadcrumb at any commit index. */
  readonly boundaryIndex: CommitRangeIndex<DomainSubflowEvent | DomainRunEvent>;
}

interface BoundaryRecorderOptions {
  // EXISTING:
  readonly id?: string;
  // NEW:
  /** Live commit-count accessor. Inject from your runner. If omitted,
   *  commitIdxBefore/After fields default to 0 (legacy mode). */
  readonly getCommitCount?: () => number;
}
```

### Event-type additions

```ts
interface DomainEventBase {
  // EXISTING:
  runtimeStageId, subflowPath, depth, ts;
  // NEW:
  /** Commit count when this event fired, BEFORE its effects. 0 if
   *  the recorder was constructed without getCommitCount. */
  commitIdxBefore: number;
  /** Commit count AFTER this event's effects. For pure observer
   *  events (no engine writes triggered), equals commitIdxBefore. */
  commitIdxAfter: number;
}
```

---

## 5. Consumer pattern — Lens example

```ts
// Lens slider at commit position N:
const breadcrumb = boundary.boundaryIndex.enclosing(N);
// → returns ranges containing N, ordered outer→inner
// → consumers read each range's `label` (which IS the DomainEvent)
//   to render breadcrumb chips, drill-in actions, etc.

// What ran during a slice (e.g., between two slider snaps):
const active = boundary.boundaryIndex.overlapping(startN, endN);
```

Lens never opens or closes ranges directly. It only reads.

---

## 6. Test contract — 7 types per Convention 3

| Type | Asks |
|---|---|
| Unit | Stamping `commitIdxBefore/After` on a single onSubflowEntry; open() called; close() called on matching exit |
| Functional | A real subflow nests another — outer range encloses inner range correctly |
| Integration | Wire to a real LLMCall runner. Verify boundaryIndex.enclosing(N) returns breadcrumb for any commit N |
| Property | Random insert of N subflows with nested entries — boundary index reports same ranges as a brute-force scan over the event stream |
| Security | Stale tokens from before runId reset are no-ops (verified by Layer 1 owner rotation) |
| Performance | 1000 boundaries built in <100ms; per-event overhead <0.1ms |
| Load | 10k events with 100 boundaries, build + 1000 queries <500ms |

---

## 7. Backward compatibility

- Existing `boundaryRecorder()` calls without `getCommitCount` keep
  working: `commitIdxBefore/After` default to 0, `boundaryIndex` is
  still a valid CommitRangeIndex (empty if no entry events fire).
- Existing consumers reading `DomainEvent` see two new fields appended
  to the type — no field removed, no field's type changed.
- The internal store + existing event types are untouched.

---

## 8. Migration impact

agentfootprint version bump: 3.0.x → 3.1.0 (minor, additive).
No lens / playground / footprintjs changes required for backwards
compat. Lens Layer 3 will adopt `boundaryIndex` opt-in.

---

## 9. What this layer does NOT do

- Does NOT compute diffs over ranges. Consumers fold commitLog themselves.
- Does NOT expose ranges to non-Boundary consumers. Each recorder
  that wants ranges builds its own (e.g., RunStepRecorder could
  add its own in a future layer; out of scope here).
- Does NOT change the dispatcher. Typed events untouched.
- Does NOT add a new recorder. Just enhances BoundaryRecorder.
