---
title: NegativeClaimCitation
---

# Interface: NegativeClaimCitation

Defined in: [src/core/agent/negativeClaims/config.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L50)

A model pointer to recorded evidence. The runtime derives the claim kind and
searched subject from the cited reads, then writes the delivered statement.
New app schemas need only restsOn. Legacy kind/about fields may remain in an
app's schema/parser, but never select the evidence interpretation.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/core/agent/negativeClaims/config.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L54)

Optional model-written display text, never an evidence identity or checked subject.

***

### kind?

> `readonly` `optional` **kind?**: `"none"` \| `"not-found"` \| `"complete"`

Defined in: [src/core/agent/negativeClaims/config.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L52)

Legacy format hint only; ignored when interpreting evidence.

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/core/agent/negativeClaims/config.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L55)
