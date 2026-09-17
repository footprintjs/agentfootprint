---
title: ToolResultClass
---

# Type Alias: ToolResultClass

> **ToolResultClass** = `"triage"` \| `"inventory"`

Defined in: [src/lib/semantics/types.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L228)

The declared class of a tool's RESULTS — what kind of answer this tool
gives, stated by whoever wrote it (`defineTool({ resultClass })`; the
`capabilities` law: declared, never inferred). The `check:semantics` gate
keys its per-class rules on it:

  • `'triage'` — a verdict about health or fault. Every sample result must
    declare coverage: a triage that cannot say what it did NOT check turns
    "everything looks fine" into a claim about ground it never stood on.
  • `'inventory'` — a population listing. Every sample result must declare
    coverage ("4 of 5 clusters"), and one with `facts` but no `render`
    hint is warned at.

Two classes, deliberately closed: each carries a rule the gate can PROVE.
A class with no rule would be dead vocabulary.
