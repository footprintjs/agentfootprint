[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FoldedConversation

# Interface: FoldedConversation

Defined in: [src/core/agent/window/folded.ts:77](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/core/agent/window/folded.ts#L77)

The smallest thing that can answer "what did this conversation fold?".

Structural rather than `AgentRunCheckpoint` on purpose: it also fits a
paused run's `conversation`, a hand-built fixture, and anything a consumer
pulled out of their own store — and it keeps this file from importing the
checkpoint module, which imports this one's sibling types.

## Properties

### folded?

> `readonly` `optional` **folded?**: readonly [`FoldedSpan`](/agentfootprint/api/generated/interfaces/FoldedSpan.md)[]

Defined in: [src/core/agent/window/folded.ts:78](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/core/agent/window/folded.ts#L78)
