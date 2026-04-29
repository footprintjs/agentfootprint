[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SelfConsistencyOptions

# Interface: SelfConsistencyOptions

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:21](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L21)

patterns/ — factory functions that compose primitives + core-flow
into well-known agent patterns from the research literature.

Each pattern is:
  - A factory function returning a `Runner` — drops into any
    `Sequence.step()`, `Parallel.branch()`, etc.
  - Purely composed — no new primitives, no state machinery beyond
    what the underlying compositions provide.
  - Documented with the canonical paper reference.

Build-time-fixed cardinality: all patterns take a FIXED
shard/branch/agent count at build time. Run-time-variable branching
is a separate (not-yet-shipped) feature and would need a
`DynamicParallel` primitive.

## Properties

### extract?

> `readonly` `optional` **extract?**: (`response`) => `string`

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:35](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L35)

Consumer-provided extractor: given a full LLM response, return the
"vote token" (e.g., the final answer stripped of the chain-of-thought
preamble). Defaults to returning the trimmed string.

#### Parameters

##### response

`string`

#### Returns

`string`

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:37](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L37)

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:29](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L29)

***

### model

> `readonly` **model**: `string`

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:23](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L23)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L36)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:22](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L22)

***

### samples

> `readonly` **samples**: `number`

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:26](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L26)

Number of parallel samples. 3 / 5 are typical; paper uses up to 40.

***

### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:24](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L24)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [agentfootprint/src/patterns/SelfConsistency.ts:28](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/SelfConsistency.ts#L28)

Sampling temperature. Defaults to a higher value (0.7) to get diverse samples.
