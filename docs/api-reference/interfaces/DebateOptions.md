[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DebateOptions

# Interface: DebateOptions

Defined in: [agentfootprint/src/patterns/Debate.ts:21](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L21)

## Properties

### criticPrompt

> `readonly` **criticPrompt**: `string`

Defined in: [agentfootprint/src/patterns/Debate.ts:27](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L27)

Critic persona — argues against the proposer's position.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [agentfootprint/src/patterns/Debate.ts:35](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L35)

***

### judgePrompt

> `readonly` **judgePrompt**: `string`

Defined in: [agentfootprint/src/patterns/Debate.ts:29](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L29)

Judge persona — reads the debate transcript, returns the verdict.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [agentfootprint/src/patterns/Debate.ts:33](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L33)

***

### model

> `readonly` **model**: `string`

Defined in: [agentfootprint/src/patterns/Debate.ts:23](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L23)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/patterns/Debate.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L34)

***

### proposerPrompt

> `readonly` **proposerPrompt**: `string`

Defined in: [agentfootprint/src/patterns/Debate.ts:25](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L25)

Proposer persona — asserts a position given the question.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/patterns/Debate.ts:22](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L22)

***

### rounds?

> `readonly` `optional` **rounds?**: `number`

Defined in: [agentfootprint/src/patterns/Debate.ts:31](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L31)

Rounds of propose+critique before the judge weighs in. Default 1.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [agentfootprint/src/patterns/Debate.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Debate.ts#L32)
