[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RoutingDecision

# Interface: RoutingDecision

Defined in: [src/patterns/LlmRouter.ts:121](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/patterns/LlmRouter.ts#L121)

The router's answer for one turn.

`agentId` absent = "no agent needed" — `message` is the final answer and
the swarm halts. `agentId` present = hand `message` to that agent next.

## Properties

### agentId?

> `readonly` `optional` **agentId?**: `string`

Defined in: [src/patterns/LlmRouter.ts:131](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/patterns/LlmRouter.ts#L131)

The chosen agent id, verbatim as the model wrote it (trimmed).
Absent when the router decided the work is done.

An id that is NOT in the roster is kept as-is rather than rewritten:
`swarm()`'s existing law then applies (the Conditional falls to its
`done` fallback, which echoes the message, and the loop guard halts).
Rewriting it would hide a real routing failure.

***

### message

> `readonly` **message**: `string`

Defined in: [src/patterns/LlmRouter.ts:133](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/patterns/LlmRouter.ts#L133)

What the next agent — or the user, on a halt — should see.

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/patterns/LlmRouter.ts:139](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/patterns/LlmRouter.ts#L139)

The model's one-sentence justification. TRACE ONLY: it is recorded on
the decision and on the `route_decided` event, and is never written
into any prompt.
