**Lens** — the composer of one whole wire surface: the tool list the model is
offered. `list(ctx)` IS a model-facing view, and every gate here is an OMISSION.

## What it reads / what it writes
- `staticTools.ts` reads a fixed list.
- `gatedTools.ts` runs each predicate once per candidate. During discovery
  a built-in ledger gate can identify the tool it demoted. An opaque gate
  conceals the decisions inside it. Calling `list(ctx)` directly still returns
  only the filtered tools.
- `../tools/skillScopedTools.ts` (in the tools layer, re-exported here) reads
  `ctx.activeSkillId`, which its own header
  (`skillScopedTools.ts` · "`ctx.activeSkillId` is the last `read_skill`
  activation, not the graph cursor") states is the last `read_skill` activation
  and NOT the graph cursor: a skill entered by an entry rule or a graph edge
  returns `[]`. The mount kernel's owners (`advanceEngagement` / `parkedMemberIds`,
  `src/maps/engagement/`) are not consulted here, and a second, unrelated
  mechanism (the park hold-out, `src/core/slots/buildToolsSlot.ts` ·
  `parkHoldOut`) removes parked tools.
- Writes: the list the tools slot serves.

## The one law here
A Lens may omit and may never deny — and an omission has a CLASS. Removing a
tool from this list removes it from what the model can even ask for, so the
class of the omission (authority or attention) has to be known by whoever
removes it.

## Files
- `../tools/toolProvider.ts` — the `ToolProvider` seam (in the tools layer, re-exported here).
- `staticTools.ts` — a fixed list, made composable.
- `gatedTools.ts` — the decorator that filters, per iteration.
- `../tools/skillScopedTools.ts` — a subset while one skill is the most recently loaded
  (in the tools layer, re-exported here).
- `index.ts`.
