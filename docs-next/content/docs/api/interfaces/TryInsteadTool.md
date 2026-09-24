---
title: TryInsteadTool
---

# Interface: TryInsteadTool

Defined in: [src/core/agent/coverage/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L83)

The other TOOL a suggestion points at, typed (9.113.0) — `tryInsteadTool`
on the declaration, `try_instead_tool` on the envelope.

The `tryInstead` sentence puts a tool's name inside prose ("…or check
cluster_inventory for the collected names."), and a reader that wants to
know WHICH tool was suggested could only find out by parsing that sentence.
This library never parses a tool name out of prose, so the name rides here
as data — BESIDE the sentence, never in its place: `try_instead` stays a
string, so every reader of it reads what it always read.

`tool` is NOT looked up. The tool may be served by a provider that resolves
per iteration, or be offered on a later turn; `absent()` requires a
non-empty name and records it as declared. Which names a provider accepts is
`core/tools.ts` · `assertValidToolName`'s question, and the library only
warns about it (dev mode), here as at `defineTool`.

## Properties

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/agent/coverage/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L85)

The tool's registered name, as a call would name it.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/coverage/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L87)

Why that tool, in the author's words ("it lists the collected names").
