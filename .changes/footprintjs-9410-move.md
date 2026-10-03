---
type: changed
bump: minor
---
**agentfootprint runs on footprintjs 9.41.0, and footprintjs owns every explanation sentence for its own honesty codes.**

- **Peer and dev range `footprintjs: ^9.41.0`** (were `^9.28.0` / `^9.29.0`; the docs site's own
  pin moves too). No source change was needed for the 9.29→9.41 removals and moves (the run
  policy, the hook registry, the id grammar, the executor split): agentfootprint used none of
  the removed members.
- **Recorded bytes move, values do not.** A commit log recorded on 9.41.0 differs from one
  recorded on 9.29.0 only in ids, tags and phase: a mount's outputMapper merge-back is recorded
  under the MOUNT (footprintjs 9.34.0 — its `runtimeStageId` / `stageId` / `stage` and the
  mount's declared milestone tags move from the previous stage's bundle to it), and a stage's
  continuation bundles carry `phase: 'exit'` (a mount's exit) or `'repeat'` (a fork child's
  fan-out settle) (9.39.0). The thirty `test/core/tools` byte-identity references were
  regenerated; a leaf-by-leaf diff found no other moved field.
- **One owner for the sentences.** The trace toolpack (`who_wrote`, `get_value`, `trace_node`'s
  parents, `backtrack`'s element mode) and `sliceToBacktrackTrace` kept their own copies of what
  footprintjs's codes mean ("never written … a closure", "reads were not recorded", "the commit
  log is empty", …). They now print `⚠ <code>: HONESTY_CODES[<code>]`, from footprintjs — the
  full sentence the FIRST time a code appears in one toolpack instance, the bare `⚠ <code>`
  after that (the sentence is already in the model's context). An exact element birth
  (`append-verb`, `whole-value`) keeps its old bytes; only an inferred one
  (`prefix-inference`) gains its code.
  `who_wrote` / `get_value` / `trace_node` read through the basis twins, so an answer resting
  on rows inside the key (a subflow seed or merge-back) is flagged `nested-rows`, and
  `get_value` no longer answers "no tracked write" for such a key (its known-key check matched
  exact rows only); `sliceToBacktrackTrace` also prints a slice's `notes` (9.33.0). *Migration:* a consumer matching the old sentences matches
  `HONESTY_CODES[code]` (or the `⚠ <code>:` prefix) instead.
