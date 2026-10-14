---
title: WireToolManifest
---

# Interface: WireToolManifest

Defined in: [src/adapters/types.ts:447](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L447)

The structural record of what one request actually carried on the wire.

## Properties

### outputFormat?

> `readonly` `optional` **outputFormat?**: `"json_schema"`

Defined in: [src/adapters/types.ts:457](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L457)

Present only when the serialized body carried a structured-output format
(Anthropic's `output_config.format`) — its `type`, read back from the
body. Absent means none crossed. A `strategy: 'native'` agent refuses a
stated manifest without it: the provider declared the capability and the
request went out unconstrained.

***

### toolNames

> `readonly` **toolNames**: readonly `string`[]

Defined in: [src/adapters/types.ts:449](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L449)

Tool names as they appear in the serialized body, in wire order.
