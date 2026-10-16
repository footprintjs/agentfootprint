---
title: HostFillFromCredential
---

# Interface: HostFillFromCredential

Defined in: [src/tools/hostFilled.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L50)

Fill from the call's resolved credential (`ctx.credential`).

## Properties

### from

> `readonly` **from**: `"credential"`

Defined in: [src/tools/hostFilled.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L51)

***

### mode?

> `readonly` `optional` **mode?**: `"user"` \| `"machine"`

Defined in: [src/tools/hostFilled.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L56)

***

### read?

> `readonly` `optional` **read?**: (`credential`) => `string`

Defined in: [src/tools/hostFilled.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L58)

Credential → argument value. Default: a bearer's `token`, an API key's `key`.

#### Parameters

##### credential

`Credential`

#### Returns

`string`

***

### scopes?

> `readonly` `optional` **scopes?**: readonly `string`[]

Defined in: [src/tools/hostFilled.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L55)

Scopes / mode for the `needs` this fill declares (ignored when the tool has its own).

***

### service?

> `readonly` `optional` **service?**: `string`

Defined in: [src/tools/hostFilled.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/hostFilled.ts#L53)

The service (`needs.credential`) — required when the tool declares no `needs`.
