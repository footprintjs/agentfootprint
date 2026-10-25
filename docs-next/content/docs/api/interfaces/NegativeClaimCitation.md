---
title: NegativeClaimCitation
---

# Interface: NegativeClaimCitation

Defined in: [src/core/agent/negativeClaims/config.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L49)

A model-selected claim checked against recorded evidence. Only the absence
family may be normalized from the read; a negative never becomes completeness.
The delivered subject and statement come from the admitted search.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/core/agent/negativeClaims/config.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L53)

Optional subject phrase. It must include the recorded subject; never delivered as a label.

***

### kind

> `readonly` **kind**: `"none"` \| `"not-found"` \| `"complete"`

Defined in: [src/core/agent/negativeClaims/config.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L51)

Selects the proposition to check; complete must be requested explicitly.

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/core/agent/negativeClaims/config.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L54)
