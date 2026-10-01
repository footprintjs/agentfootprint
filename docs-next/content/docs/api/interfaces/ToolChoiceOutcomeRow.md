---
title: ToolChoiceOutcomeRow
---

# Interface: ToolChoiceOutcomeRow

Defined in: src/core/agent/toolChoice/types.ts:115

What the model DID, filed after its reply by `callLLM` — the same stage
that assembled the request the pick was made for — so pick → served →
called is one triple per call.

## Properties

### called

> `readonly` **called**: readonly `string`[]

Defined in: src/core/agent/toolChoice/types.ts:119

The model's tool calls this turn, in order; empty on an answer.

***

### firstAgrees?

> `readonly` `optional` **firstAgrees?**: `boolean`

Defined in: src/core/agent/toolChoice/types.ts:121

`chosen === called[0]`; absent when either side is absent.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/toolChoice/types.ts:117

***

### kind

> `readonly` **kind**: `"outcome"`

Defined in: src/core/agent/toolChoice/types.ts:116

***

### miss?

> `readonly` `optional` **miss?**: `object`

Defined in: src/core/agent/toolChoice/types.ts:123

Present when the call was NARROWED and the model named a tool outside `served`.

#### wanted

> `readonly` **wanted**: readonly `string`[]
