---
title: DefineToolOptions<TArgs, TResult>
---

# Interface: DefineToolOptions\<TArgs, TResult\>

Defined in: [src/core/tools.ts:676](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L676)

Convenience input for `defineTool` — flatter than `Tool` itself.
Consumers describe the tool inline; the helper assembles `schema`.

`inputSchema` is a JSON Schema object (the same one the LLM will
see). For tools that take no arguments, pass `{ type: 'object',
properties: {} }` or omit and we'll default to that.

## Type Parameters

### TArgs

`TArgs`

### TResult

`TResult`

## Properties

### argumentsFrom?

> `readonly` `optional` **argumentsFrom?**: readonly `string`[]

Defined in: [src/core/tools.ts:710](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L710)

The declared argument grounds — see [Tool.argumentsFrom](/docs/api/interfaces/Tool#argumentsfrom).

***

### capabilities?

> `readonly` `optional` **capabilities?**: readonly [`ToolCapability`](/docs/api/type-aliases/ToolCapability)[]

Defined in: [src/core/tools.ts:695](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L695)

Declare what this tool touches (see [Tool.capabilities](/docs/api/interfaces/Tool#capabilities)). Consulted
 only when the configured checker declares it governs them.

***

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/docs/api/type-aliases/CheckInDemand)\<`TArgs`\>

Defined in: [src/core/tools.ts:689](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L689)

Demand a human check-in before this tool runs (see [Tool.checkIn](/docs/api/interfaces/Tool#checkin)).
 `'always'` or a `(args, ctx) => boolean` predicate.

***

### checkInComponent?

> `readonly` `optional` **checkInComponent?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: [src/core/tools.ts:692](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L692)

The registered screen component that collects the check-in decision
 (see [Tool.checkInComponent](/docs/api/interfaces/Tool#checkincomponent)). Requires `checkIn`.

***

### description

> `readonly` **description**: `string`

Defined in: [src/core/tools.ts:678](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L678)

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/tools.ts:679](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L679)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/tools.ts:677](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L677)

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/tools.ts:682](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L682)

Declare a credential this tool needs (declare-and-push). Resolved by the
 framework before `execute` and injected as `ctx.credential`.

***

### owner?

> `readonly` `optional` **owner?**: `ToolOwner`

Defined in: [src/core/tools.ts:708](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L708)

The stamped identity edge — see [Tool.owner](/docs/api/interfaces/Tool#owner).

***

### repeatedWhen?

> `readonly` `optional` **repeatedWhen?**: `"arguments"`

Defined in: [src/core/tools.ts:714](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L714)

Fingerprint the repeated-call ledger on arguments alone, ignoring this
 tool's own result — see [Tool.repeatedWhen](/docs/api/interfaces/Tool#repeatedwhen). Omitted →
 byte-identical (the ledger keeps comparing results, as always).

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/docs/api/interfaces/ToolResultCeiling)

Defined in: [src/core/tools.ts:698](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L698)

Refuse (never truncate) a result over this many chars, teaching the model
 to narrow (see [ToolResultCeiling](/docs/api/interfaces/ToolResultCeiling)). Omitted → byte-identical.

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/docs/api/type-aliases/ToolResultClass)

Defined in: [src/core/tools.ts:702](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L702)

The declared class of this tool's results — `'triage'` or `'inventory'`
 (see [Tool.resultClass](/docs/api/interfaces/Tool#resultclass)). Keys the `check:semantics` per-class
 rules. Omitted → no class rules.

***

### resultKind?

> `readonly` `optional` **resultKind?**: `string`

Defined in: [src/core/tools.ts:706](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L706)

The artifact kind a PLACED result is minted under, in the consumer's
 vocabulary (see [Tool.resultKind](/docs/api/interfaces/Tool#resultkind)). Omitted →
 `tool-result/<name>`, byte-identical.

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/tools.ts:686](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L686)

Declare artifact arguments: arg name → required artifact kind (see
 [Tool.wants](/docs/api/interfaces/Tool#wants)). The model passes the `art_…` ref; the framework
 resolves it before `execute` and the handler reads the data.

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:715](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L715)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
