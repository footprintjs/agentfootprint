---
title: RoutingStrategy
---

# Interface: RoutingStrategy

Defined in: [src/patterns/routing.ts:11](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/routing.ts#L11)

A routing strategy supplies a once-built native runner, not a lookup cache.

## Extended by

- [`LlmRouter`](/docs/api/interfaces/LlmRouter)

## Properties

### step

> `readonly` **step**: [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, [`RoutingDecision`](/docs/api/interfaces/RoutingDecision)\>

Defined in: [src/patterns/routing.ts:12](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/routing.ts#L12)
