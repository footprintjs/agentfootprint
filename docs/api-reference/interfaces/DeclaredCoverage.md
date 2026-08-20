[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DeclaredCoverage

# Interface: DeclaredCoverage

Defined in: [src/core/agent/coverage/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L143)

One coverage statement as the RUN recorded it — what the event carries and
what accumulates in `AgentState.coverageDeclared`.

`kind` is kept because the two read differently at the answer boundary: a
`'ledger'` bounds a verdict the answer is probably built on, an
`'absence'` bounds a search that found nothing.

## Extends

- [`Coverage`](/agentfootprint/api/generated/interfaces/Coverage.md)

## Properties

### cannotCover

> `readonly` **cannotCover**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L56)

#### Inherited from

[`Coverage`](/agentfootprint/api/generated/interfaces/Coverage.md).[`cannotCover`](/agentfootprint/api/generated/interfaces/Coverage.md#cannotcover)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L54)

#### Inherited from

[`Coverage`](/agentfootprint/api/generated/interfaces/Coverage.md).[`checked`](/agentfootprint/api/generated/interfaces/Coverage.md#checked)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/coverage/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L147)

***

### kind

> `readonly` **kind**: `"absence"` \| `"ledger"`

Defined in: [src/core/agent/coverage/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L144)

***

### lookedFor?

> `readonly` `optional` **lookedFor?**: `string`

Defined in: [src/core/agent/coverage/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L149)

Present for `'absence'` only — what the search was for.

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L55)

#### Inherited from

[`Coverage`](/agentfootprint/api/generated/interfaces/Coverage.md).[`notChecked`](/agentfootprint/api/generated/interfaces/Coverage.md#notchecked)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/coverage/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L146)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/coverage/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L145)
