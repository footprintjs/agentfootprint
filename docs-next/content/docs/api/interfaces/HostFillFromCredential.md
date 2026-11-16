---
title: HostFillFromCredential
---

# Interface: HostFillFromCredential

Defined in: [src/tools/hostFilled.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L58)

Fill from the call's resolved credential (`ctx.credential`).

## Properties

### from

> `readonly` **from**: `"credential"`

Defined in: [src/tools/hostFilled.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L59)

***

### mode?

> `readonly` `optional` **mode?**: `"user"` \| `"machine"`

Defined in: [src/tools/hostFilled.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L64)

***

### read?

> `readonly` `optional` **read?**: (`credential`) => `string`

Defined in: [src/tools/hostFilled.ts:66](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L66)

Credential → argument value. Default: a bearer's `token`, an API key's `key`.

#### Parameters

##### credential

`Credential`

#### Returns

`string`

***

### scopes?

> `readonly` `optional` **scopes?**: readonly `string`[]

Defined in: [src/tools/hostFilled.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L63)

Scopes / mode for the `needs` this fill declares (ignored when the tool has its own).

***

### service?

> `readonly` `optional` **service?**: `string`

Defined in: [src/tools/hostFilled.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L61)

The service (`needs.credential`) — required when the tool declares no `needs`.
