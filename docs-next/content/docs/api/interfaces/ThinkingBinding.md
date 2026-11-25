---
title: ThinkingBinding
---

# Interface: ThinkingBinding

Defined in: [src/provider-contract/types/provider.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L292)

A provider's answer to `thinkingBinding`: the fact, and who stated it.

## Properties

### binding

> `readonly` **binding**: `"unknown"` \| `"bound"` \| `"unbound"`

Defined in: [src/provider-contract/types/provider.ts:298](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L298)

`bound`: a thinking block is valid only under the system prompt, tool list
and earlier messages it was written under. `unbound`: it is not. `unknown`:
the provider cannot tell for this model id (an id its table cannot place).

***

### by

> `readonly` **by**: `"app"` \| `"provider"`

Defined in: [src/provider-contract/types/provider.ts:300](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L300)

`provider`: the adapter's own knowledge. `app`: the application stated it.
