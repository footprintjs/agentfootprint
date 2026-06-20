---
title: debate
---

# Function: debate()

> **debate**(`opts`): [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Debate.ts:43](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/patterns/Debate.ts#L43)

Build a Debate Runner. One debate "round" = Proposer → Critic. After
N rounds, the Judge sees the final exchange and renders the verdict.
The Judge's output is the Runner's return value.

## Parameters

### opts

[`DebateOptions`](/docs/api/interfaces/DebateOptions)

## Returns

[`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>
