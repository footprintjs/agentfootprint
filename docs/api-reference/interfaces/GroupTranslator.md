[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / GroupTranslator

# Interface: GroupTranslator()\<T\>

Defined in: [src/core/translator.ts:97](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/core/translator.ts#L97)

The consumer-supplied translator. Pure function — no async, no
side effects expected. Runs ONCE per composition at the moment
`getUIGroup()` is first called (memoised behaviour is per
composition's discretion).

Output type `T` is whatever the consumer wants — a React Flow
group node, a Mermaid string, a domain-specific layout object,
anything. agentfootprint stays UI-agnostic.

## Type Parameters

### T

`T` = `unknown`

> **GroupTranslator**(`group`): `T`

Defined in: [src/core/translator.ts:98](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/core/translator.ts#L98)

The consumer-supplied translator. Pure function — no async, no
side effects expected. Runs ONCE per composition at the moment
`getUIGroup()` is first called (memoised behaviour is per
composition's discretion).

Output type `T` is whatever the consumer wants — a React Flow
group node, a Mermaid string, a domain-specific layout object,
anything. agentfootprint stays UI-agnostic.

## Parameters

### group

[`GroupMetadata`](/agentfootprint/api/generated/interfaces/GroupMetadata.md)

## Returns

`T`
