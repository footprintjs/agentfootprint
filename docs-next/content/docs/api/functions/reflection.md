---
title: reflection
---

# Function: reflection()

> **reflection**(`opts`): [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Reflection.ts:55](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/patterns/Reflection.ts#L55)

Build a Reflection Runner. Each iteration:
  1. Propose — LLMCall writes a candidate answer based on the input
  2. Critique — LLMCall judges the candidate; exit marker stops loop
  3. Revise — next iteration's propose sees the previous critique

Each iteration's output (the candidate proposal) becomes the next
iteration's input. The final iteration's proposal is returned.

## Parameters

### opts

[`ReflectionOptions`](/docs/api/interfaces/ReflectionOptions)

## Returns

[`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>
