---
title: GraphProblem
---

# Interface: GraphProblem

Defined in: [src/lib/injection-engine/skillGraphCheckup.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraphCheckup.ts#L28)

One issue found by the check-up. `kind: 'error'` fails `ok` (and `'throw'`).

## Properties

### code

> `readonly` **code**: [`GraphProblemCode`](/docs/api/type-aliases/GraphProblemCode)

Defined in: [src/lib/injection-engine/skillGraphCheckup.ts:30](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraphCheckup.ts#L30)

***

### from?

> `readonly` `optional` **from?**: `string`

Defined in: [src/lib/injection-engine/skillGraphCheckup.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraphCheckup.ts#L34)

***

### kind

> `readonly` **kind**: `"error"` \| `"warning"`

Defined in: [src/lib/injection-engine/skillGraphCheckup.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraphCheckup.ts#L29)

***

### message

> `readonly` **message**: `string`

Defined in: [src/lib/injection-engine/skillGraphCheckup.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraphCheckup.ts#L31)

***

### skill?

> `readonly` `optional` **skill?**: `string`

Defined in: [src/lib/injection-engine/skillGraphCheckup.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraphCheckup.ts#L33)

The skill the problem is about (unreachable/ambiguous source).

***

### to?

> `readonly` `optional` **to?**: `string`

Defined in: [src/lib/injection-engine/skillGraphCheckup.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraphCheckup.ts#L35)
