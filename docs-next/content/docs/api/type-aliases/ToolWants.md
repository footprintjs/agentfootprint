---
title: ToolWants
---

# Type Alias: ToolWants

> **ToolWants** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/artifacts/wants.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/wants.ts#L33)

The declaration on a tool: argument name → the artifact `kind` that
argument must resolve to (consumer vocabulary, exact-match — no wildcards,
no hierarchy; `'dataset/rows'` is one kind, not a family).
