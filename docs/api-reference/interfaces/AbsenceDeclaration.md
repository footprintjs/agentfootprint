[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AbsenceDeclaration

# Interface: AbsenceDeclaration

Defined in: [src/core/agent/coverage/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L67)

What a tool author passes to import('./absent.js').absent.

## Properties

### cannotCover?

> `readonly` `optional` **cannotCover?**: readonly [`CoverageInput`](/agentfootprint/api/generated/type-aliases/CoverageInput.md)[]

Defined in: [src/core/agent/coverage/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L85)

Ground no search by this tool can reach. Each needs a `why`.

***

### checked

> `readonly` **checked**: readonly [`CoverageInput`](/agentfootprint/api/generated/type-aliases/CoverageInput.md)[]

Defined in: [src/core/agent/coverage/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L80)

The coverage of the search — REQUIRED and non-empty. An absence that
names no coverage is a `null` with extra steps: the reader still cannot
tell "I looked and there is nothing" from "I could not look", which is
the entire failure this primitive exists to prevent.

***

### notChecked?

> `readonly` `optional` **notChecked?**: readonly [`CoverageInput`](/agentfootprint/api/generated/type-aliases/CoverageInput.md)[]

Defined in: [src/core/agent/coverage/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L83)

Ground the search did not reach this time — an absence here proves
 nothing about it.

***

### tryInstead?

> `readonly` `optional` **tryInstead?**: `string`

Defined in: [src/core/agent/coverage/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L92)

Where to go INSTEAD, in one sentence ("widen the window with
`window: '7d'`, or ask for a different interface"). Optional, and the
highest-value optional field in the shape: the loop this primitive stops
is a model with nowhere else to go.

***

### what

> `readonly` **what**: `string`

Defined in: [src/core/agent/coverage/types.ts:73](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/coverage/types.ts#L73)

What was looked for, in the author's own words ("FLOGI entries on
fc1/3"). Required: an absence that cannot say what it did not find is
indistinguishable from a tool that returned nothing by accident.
