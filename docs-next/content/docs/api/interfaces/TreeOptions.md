---
title: TreeOptions
---

# Interface: TreeOptions

Defined in: [src/lib/injection-engine/skillGraph.ts:134](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L134)

Options for a decision `tree()`.

## Properties

### scopeTools?

> `readonly` `optional` **scopeTools?**: `boolean`

Defined in: [src/lib/injection-engine/skillGraph.ts:148](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L148)

Scope the tool list to the routed leaf (the on-demand-tools default).

A decision tree routes to EXACTLY ONE skill per iteration, so each leaf is
stamped `autoActivate: 'currentSkill'` — its `inject.tools` reach the LLM
ONLY when the tree routes there, instead of every skill's tools landing in
the always-on static registry on every call. `read_skill` stays available as
the escape hatch to reach another skill mid-run.

Default `true`. Set `false` for the legacy additive behavior (all leaves'
tools always visible). A leaf that sets its OWN `autoActivate` in
`defineSkill(...)` is always respected — this only fills the default.
