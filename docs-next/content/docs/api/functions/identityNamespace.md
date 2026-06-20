---
title: identityNamespace
---

# Function: identityNamespace()

> **identityNamespace**(`identity`): `string`

Defined in: [src/memory/identity/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/identity/types.ts#L52)

Encode a MemoryIdentity as a deterministic storage namespace. Used by
storage adapters that need a single string key (Redis, localStorage,
filesystem paths). Format is stable across library versions — adapters
can safely use it for long-lived keys.

Empty `tenant` / `principal` collapse to `_` so the format has a constant
shape (easy to parse, easy to list by prefix).

## Parameters

### identity

[`MemoryIdentity`](/docs/api/interfaces/MemoryIdentity)

## Returns

`string`
