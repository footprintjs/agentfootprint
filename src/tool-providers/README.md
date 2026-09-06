**Lens** — the composer of one whole wire surface: the tool list the model is
offered. `list(ctx)` IS a model-facing view, and every gate here is an OMISSION.

## What it reads / what it writes
- `staticTools.ts` reads a fixed list.
- `gatedTools.ts` reads a caller-supplied predicate — and nothing else. It
  cannot tell an AUTHORITY omission (a permission policy; must be invisible)
  from an ATTENTION omission (a budget or scope; must be visible), it emits
  nothing, and it leaves no record of which tools it removed.
- `skillScopedTools.ts` reads `ctx.activeSkillId`, which its own header
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
- `types.ts` — the `ToolProvider` seam.
- `staticTools.ts` — a fixed list, made composable.
- `gatedTools.ts` — the decorator that filters, per iteration.
- `skillScopedTools.ts` — a subset while one skill is the most recently loaded.
- `index.ts`.
