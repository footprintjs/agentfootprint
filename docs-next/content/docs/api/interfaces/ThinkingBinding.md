---
title: ThinkingBinding
---

# Interface: ThinkingBinding

Defined in: [src/provider-contract/types/provider.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L293)

A provider's answer to `thinkingBinding`: the fact, and who stated it.

## Properties

### appStatement?

> `readonly` `optional` **appStatement?**: `"failed"`

Defined in: [src/provider-contract/types/provider.ts:315](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L315)

The app's statement for this id was asked and could not be used (it threw or answered something else).

***

### binding

> `readonly` **binding**: `"unknown"` \| `"bound"` \| `"unbound"`

Defined in: [src/provider-contract/types/provider.ts:299](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L299)

`bound`: a thinking block is valid only under the system prompt, tool list
and earlier messages it was written under. `unbound`: it is not. `unknown`:
the provider cannot tell for this model id (an id its table cannot place).

***

### by

> `readonly` **by**: `"app"` \| `"provider"`

Defined in: [src/provider-contract/types/provider.ts:301](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L301)

`provider`: the adapter's own knowledge. `app`: the application stated it.

***

### family?

> `readonly` `optional` **family?**: `string`

Defined in: [src/provider-contract/types/provider.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L307)

The model family the provider resolved the id to, when it knows it. Two
ids of one family read each other's reasoning bindings (a dated id and its
alias); a block written by another family is not checked against this one.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/provider-contract/types/provider.ts:313](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/provider.ts#L313)

The model id the provider resolved the asked id to — an adapter's
shorthand (`'anthropic'`) becomes the id it actually sends. Absent: the
asked id is the one sent.
