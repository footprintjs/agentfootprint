---
title: WireToolManifest
---

# Interface: WireToolManifest

Defined in: [src/provider-contract/types.ts:459](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L459)

The structural record of what one request actually carried on the wire.

## Properties

### outputFormat?

> `readonly` `optional` **outputFormat?**: `"json_schema"`

Defined in: [src/provider-contract/types.ts:469](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L469)

Present only when the serialized body carried a structured-output format
(Anthropic's `output_config.format`) — its `type`, read back from the
body. Absent means none crossed. A `strategy: 'native'` agent refuses a
stated manifest without it: the provider declared the capability and the
request went out unconstrained.

***

### toolNames

> `readonly` **toolNames**: readonly `string`[]

Defined in: [src/provider-contract/types.ts:461](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L461)

Tool names as they appear in the serialized body, in wire order.
