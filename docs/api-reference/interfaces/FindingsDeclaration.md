[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FindingsDeclaration

# Interface: FindingsDeclaration

Defined in: [src/core/agent/findings/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L94)

The wire shape under `_findings` — on a tool call's args, or as the top-level
key of a JSON answer. Every field optional: the model declares what it
declares, and `reserved.ts · splitFindings` drops what it cannot read.

## Properties

### basis?

> `readonly` `optional` **basis?**: [`Basis`](/agentfootprint/api/generated/type-aliases/Basis.md)

Defined in: [src/core/agent/findings/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L95)

***

### expect?

> `readonly` `optional` **expect?**: [`Expect`](/agentfootprint/api/generated/type-aliases/Expect.md)

Defined in: [src/core/agent/findings/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L96)

***

### predicts?

> `readonly` `optional` **predicts?**: `string`

Defined in: [src/core/agent/findings/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L105)

What the result should show if the proposition holds — one line, optional.

***

### previous?

> `readonly` `optional` **previous?**: readonly `PreviousStanding`[]

Defined in: [src/core/agent/findings/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L106)

***

### proposition?

> `readonly` `optional` **proposition?**: `string`

Defined in: [src/core/agent/findings/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L103)

What the call tests — one line, declared BEFORE the result exists, so a
later `ruled-out` or `open` standing on that result can be read against
a proposition the model wrote without seeing the result. Optional; the
schema recommends it when `basis` is `'exploratory'`.
