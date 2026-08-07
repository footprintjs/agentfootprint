[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FoldedConversation

# Interface: FoldedConversation

Defined in: [src/core/agent/window/folded.ts:59](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/folded.ts#L59)

The smallest thing that can answer "what did this conversation fold?".

Structural rather than `AgentRunCheckpoint` on purpose: it also fits a
paused run's `conversation`, a hand-built fixture, and anything a consumer
pulled out of their own store — and it keeps this file from importing the
checkpoint module, which imports this one's sibling types.

## Properties

### folded?

> `readonly` `optional` **folded?**: readonly [`FoldedSpan`](/agentfootprint/api/generated/interfaces/FoldedSpan.md)[]

Defined in: [src/core/agent/window/folded.ts:60](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/window/folded.ts#L60)
