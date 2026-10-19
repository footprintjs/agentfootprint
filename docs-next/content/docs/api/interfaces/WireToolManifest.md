---
title: WireToolManifest
---

# Interface: WireToolManifest

Defined in: [src/provider-contract/types.ts:456](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L456)

The structural record of what one request actually carried on the wire.

## Properties

### outputFormat?

> `readonly` `optional` **outputFormat?**: `"json_schema"`

Defined in: [src/provider-contract/types.ts:466](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L466)

Present only when the serialized body carried a structured-output format
(Anthropic's `output_config.format`) — its `type`, read back from the
body. Absent means none crossed. A `strategy: 'native'` agent refuses a
stated manifest without it: the provider declared the capability and the
request went out unconstrained.

***

### toolNames

> `readonly` **toolNames**: readonly `string`[]

Defined in: [src/provider-contract/types.ts:458](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L458)

Tool names as they appear in the serialized body, in wire order.
