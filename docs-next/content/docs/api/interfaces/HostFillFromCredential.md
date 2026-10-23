---
title: HostFillFromCredential
---

# Interface: HostFillFromCredential

Defined in: [src/tools/hostFilled.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L51)

Fill from the call's resolved credential (`ctx.credential`).

## Properties

### from

> `readonly` **from**: `"credential"`

Defined in: [src/tools/hostFilled.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L52)

***

### mode?

> `readonly` `optional` **mode?**: `"user"` \| `"machine"`

Defined in: [src/tools/hostFilled.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L57)

***

### read?

> `readonly` `optional` **read?**: (`credential`) => `string`

Defined in: [src/tools/hostFilled.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L59)

Credential → argument value. Default: a bearer's `token`, an API key's `key`.

#### Parameters

##### credential

`Credential`

#### Returns

`string`

***

### scopes?

> `readonly` `optional` **scopes?**: readonly `string`[]

Defined in: [src/tools/hostFilled.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L56)

Scopes / mode for the `needs` this fill declares (ignored when the tool has its own).

***

### service?

> `readonly` `optional` **service?**: `string`

Defined in: [src/tools/hostFilled.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L54)

The service (`needs.credential`) — required when the tool declares no `needs`.
