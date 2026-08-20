[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineToolOptions

# Interface: DefineToolOptions\<TArgs, TResult\>

Defined in: [src/core/tools.ts:452](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L452)

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

### capabilities?

> `readonly` `optional` **capabilities?**: readonly [`ToolCapability`](/agentfootprint/api/generated/type-aliases/ToolCapability.md)[]

Defined in: [src/core/tools.ts:471](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L471)

Declare what this tool touches (see [Tool.capabilities](/agentfootprint/api/generated/interfaces/Tool.md#capabilities)). Consulted
 only when the configured checker declares it governs them.

***

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/agentfootprint/api/generated/type-aliases/CheckInDemand.md)\<`TArgs`\>

Defined in: [src/core/tools.ts:465](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L465)

Demand a human check-in before this tool runs (see [Tool.checkIn](/agentfootprint/api/generated/interfaces/Tool.md#checkin)).
 `'always'` or a `(args, ctx) => boolean` predicate.

***

### checkInComponent?

> `readonly` `optional` **checkInComponent?**: [`AskComponent`](/agentfootprint/api/generated/interfaces/AskComponent.md)

Defined in: [src/core/tools.ts:468](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L468)

The registered screen component that collects the check-in decision
 (see [Tool.checkInComponent](/agentfootprint/api/generated/interfaces/Tool.md#checkincomponent)). Requires `checkIn`.

***

### description

> `readonly` **description**: `string`

Defined in: [src/core/tools.ts:454](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L454)

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/tools.ts:455](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L455)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/tools.ts:453](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L453)

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/tools.ts:458](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L458)

Declare a credential this tool needs (declare-and-push). Resolved by the
 framework before `execute` and injected as `ctx.credential`.

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/agentfootprint/api/generated/interfaces/ToolResultCeiling.md)

Defined in: [src/core/tools.ts:474](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L474)

Refuse (never truncate) a result over this many chars, teaching the model
 to narrow (see [ToolResultCeiling](/agentfootprint/api/generated/interfaces/ToolResultCeiling.md)). Omitted → byte-identical.

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/agentfootprint/api/generated/type-aliases/ToolResultClass.md)

Defined in: [src/core/tools.ts:478](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L478)

The declared class of this tool's results — `'triage'` or `'inventory'`
 (see [Tool.resultClass](/agentfootprint/api/generated/interfaces/Tool.md#resultclass)). Keys the `check:semantics` per-class
 rules. Omitted → no class rules.

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/tools.ts:462](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L462)

Declare artifact arguments: arg name → required artifact kind (see
 [Tool.wants](/agentfootprint/api/generated/interfaces/Tool.md#wants)). The model passes the `art_…` ref; the framework
 resolves it before `execute` and the handler reads the data.

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:479](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/tools.ts#L479)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
