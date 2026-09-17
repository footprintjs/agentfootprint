---
title: GroupTranslator()<T>
---

# Interface: GroupTranslator()\<T\>

Defined in: [src/core/translator.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/translator.ts#L97)

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

Defined in: [src/core/translator.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/core/translator.ts#L98)

The consumer-supplied translator. Pure function — no async, no
side effects expected. Runs ONCE per composition at the moment
`getUIGroup()` is first called (memoised behaviour is per
composition's discretion).

Output type `T` is whatever the consumer wants — a React Flow
group node, a Mermaid string, a domain-specific layout object,
anything. agentfootprint stays UI-agnostic.

## Parameters

### group

[`GroupMetadata`](/docs/api/interfaces/GroupMetadata)

## Returns

`T`
