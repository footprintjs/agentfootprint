---
title: FoldedConversation
---

# Interface: FoldedConversation

Defined in: [src/core/agent/window/folded.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/folded.ts#L85)

The smallest thing that can answer "what did this conversation fold?".

Structural rather than `AgentRunCheckpoint` on purpose: it also fits a
paused run's `conversation`, a hand-built fixture, and anything a consumer
pulled out of their own store — and it keeps this file from importing the
checkpoint module, which imports this one's sibling types.

## Properties

### folded?

> `readonly` `optional` **folded?**: readonly [`FoldedSpan`](/docs/api/interfaces/FoldedSpan)[]

Defined in: [src/core/agent/window/folded.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/folded.ts#L86)
