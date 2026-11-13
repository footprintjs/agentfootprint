---
title: WireToolManifest
---

# Interface: WireToolManifest

Defined in: [src/provider-contract/types.ts:495](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L495)

The structural record of what one request actually carried on the wire.

## Properties

### outputFormat?

> `readonly` `optional` **outputFormat?**: `"json_schema"`

Defined in: [src/provider-contract/types.ts:505](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L505)

Present only when the serialized body carried a structured-output format
(Anthropic's `output_config.format`) — its `type`, read back from the
body. Absent means none crossed. A `strategy: 'native'` agent refuses a
stated manifest without it: the provider declared the capability and the
request went out unconstrained.

***

### toolNames

> `readonly` **toolNames**: readonly `string`[]

Defined in: [src/provider-contract/types.ts:497](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L497)

Tool names as they appear in the serialized body, in wire order.
