[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineToolOptions

# Interface: DefineToolOptions\<TArgs, TResult\>

Defined in: [src/core/tools.ts:894](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L894)

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

Defined in: [src/core/tools.ts:932](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L932)

The declared argument grounds — see [Tool.argumentsFrom](/agentfootprint/api/generated/interfaces/Tool.md#argumentsfrom).

***

### capabilities?

> `readonly` `optional` **capabilities?**: readonly [`ToolCapability`](/agentfootprint/api/generated/type-aliases/ToolCapability.md)[]

Defined in: [src/core/tools.ts:913](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L913)

Declare what this tool touches (see [Tool.capabilities](/agentfootprint/api/generated/interfaces/Tool.md#capabilities)). Consulted
 only when the configured checker declares it governs them.

***

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/agentfootprint/api/generated/type-aliases/CheckInDemand.md)\<`TArgs`\>

Defined in: [src/core/tools.ts:907](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L907)

Demand a human check-in before this tool runs (see [Tool.checkIn](/agentfootprint/api/generated/interfaces/Tool.md#checkin)).
 `'always'` or a `(args, ctx) => boolean` predicate.

***

### checkInComponent?

> `readonly` `optional` **checkInComponent?**: [`AskComponent`](/agentfootprint/api/generated/interfaces/AskComponent.md)

Defined in: [src/core/tools.ts:910](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L910)

The registered screen component that collects the check-in decision
 (see [Tool.checkInComponent](/agentfootprint/api/generated/interfaces/Tool.md#checkincomponent)). Requires `checkIn`.

***

### composedOf?

> `readonly` `optional` **composedOf?**: readonly `string`[]

Defined in: [src/core/tools.ts:936](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L936)

The named ingredient tools this tool calls through `ctx.tools` — see
 [Tool.composedOf](/agentfootprint/api/generated/interfaces/Tool.md#composedof). Drift-checked at agent build, when the catalog
 is complete. Omitted → nothing checked, byte-identical.

***

### description

> `readonly` **description**: `string`

Defined in: [src/core/tools.ts:896](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L896)

***

### gates?

> `readonly` `optional` **gates?**: `boolean`

Defined in: [src/core/tools.ts:939](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L939)

Whether this tool's procedure can raise an approval gate — see
 [Tool.gates](/agentfootprint/api/generated/interfaces/Tool.md#gates). Omitted → nothing declared, byte-identical.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/tools.ts:897](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L897)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/tools.ts:895](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L895)

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/tools.ts:900](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L900)

Declare a credential this tool needs (declare-and-push). Resolved by the
 framework before `execute` and injected as `ctx.credential`.

***

### owner?

> `readonly` `optional` **owner?**: `ToolOwner`

Defined in: [src/core/tools.ts:930](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L930)

The stamped identity edge — see [Tool.owner](/agentfootprint/api/generated/interfaces/Tool.md#owner).

***

### repeatedWhen?

> `readonly` `optional` **repeatedWhen?**: `"arguments"`

Defined in: [src/core/tools.ts:943](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L943)

Fingerprint the repeated-call ledger on arguments alone, ignoring this
 tool's own result — see [Tool.repeatedWhen](/agentfootprint/api/generated/interfaces/Tool.md#repeatedwhen). Omitted →
 byte-identical (the ledger keeps comparing results, as always).

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/agentfootprint/api/generated/interfaces/ToolResultCeiling.md)

Defined in: [src/core/tools.ts:916](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L916)

Refuse (never truncate) a result over this many chars, teaching the model
 to narrow (see [ToolResultCeiling](/agentfootprint/api/generated/interfaces/ToolResultCeiling.md)). Omitted → byte-identical.

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/agentfootprint/api/generated/type-aliases/ToolResultClass.md)

Defined in: [src/core/tools.ts:920](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L920)

The declared class of this tool's results — `'triage'` or `'inventory'`
 (see [Tool.resultClass](/agentfootprint/api/generated/interfaces/Tool.md#resultclass)). Keys the `check:semantics` per-class
 rules. Omitted → no class rules.

***

### resultColumns?

> `readonly` `optional` **resultColumns?**: `Readonly`\<`Record`\<`string`, [`ColumnType`](/agentfootprint/api/generated/type-aliases/ColumnType.md) \| [`ColumnDeclaration`](/agentfootprint/api/generated/interfaces/ColumnDeclaration.md)\>\>

Defined in: [src/core/tools.ts:928](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L928)

What this tool's ROWS contain — column name to type (see
 [Tool.resultColumns](/agentfootprint/api/generated/interfaces/Tool.md#resultcolumns)). Needs the `checkColumnTypes` dial too.
 Omitted → nothing measured, byte-identical.

***

### resultKind?

> `readonly` `optional` **resultKind?**: `string`

Defined in: [src/core/tools.ts:924](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L924)

The artifact kind a PLACED result is minted under, in the consumer's
 vocabulary (see [Tool.resultKind](/agentfootprint/api/generated/interfaces/Tool.md#resultkind)). Omitted →
 `tool-result/<name>`, byte-identical.

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/tools.ts:904](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L904)

Declare artifact arguments: arg name → required artifact kind (see
 [Tool.wants](/agentfootprint/api/generated/interfaces/Tool.md#wants)). The model passes the `art_…` ref; the framework
 resolves it before `execute` and the handler reads the data.

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:944](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L944)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
