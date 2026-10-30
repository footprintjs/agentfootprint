---
title: DefineToolOptions<TArgs, TResult>
---

# Interface: DefineToolOptions\<TArgs, TResult\>

Defined in: [src/tools/tools.ts:1110](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1110)

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

Defined in: [src/tools/tools.ts:1148](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1148)

The declared argument grounds — see [Tool.argumentsFrom](/docs/api/interfaces/Tool#argumentsfrom).

***

### askOrAssume?

> `readonly` `optional` **askOrAssume?**: `Readonly`\<`Record`\<`string`, `ArgumentRule`\>\>

Defined in: [src/tools/tools.ts:1162](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1162)

Per-argument rules — what the library does when a call leaves an argument
 out (see [Tool.askOrAssume](/docs/api/interfaces/Tool#askorassume)). Omitted → byte-identical.

***

### capabilities?

> `readonly` `optional` **capabilities?**: readonly [`ToolCapability`](/docs/api/type-aliases/ToolCapability)[]

Defined in: [src/tools/tools.ts:1129](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1129)

Declare what this tool touches (see [Tool.capabilities](/docs/api/interfaces/Tool#capabilities)). Consulted
 only when the configured checker declares it governs them.

***

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/docs/api/type-aliases/CheckInDemand)\<`TArgs`\>

Defined in: [src/tools/tools.ts:1123](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1123)

Demand a human check-in before this tool runs (see [Tool.checkIn](/docs/api/interfaces/Tool#checkin)).
 `'always'` or a `(args, ctx) => boolean` predicate.

***

### checkInComponent?

> `readonly` `optional` **checkInComponent?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: [src/tools/tools.ts:1126](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1126)

The registered screen component that collects the check-in decision
 (see [Tool.checkInComponent](/docs/api/interfaces/Tool#checkincomponent)). Requires `checkIn`.

***

### composedOf?

> `readonly` `optional` **composedOf?**: readonly `string`[]

Defined in: [src/tools/tools.ts:1152](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1152)

The named ingredient tools this tool calls through `ctx.tools` — see
 [Tool.composedOf](/docs/api/interfaces/Tool#composedof). Drift-checked at agent build, when the catalog
 is complete. Omitted → nothing checked, byte-identical.

***

### description

> `readonly` **description**: `string`

Defined in: [src/tools/tools.ts:1112](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1112)

***

### displayName?

> `readonly` `optional` **displayName?**: `string`

Defined in: [src/tools/tools.ts:1178](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1178)

The app's own words for what a call of this tool does, read by a person
 (see [Tool.displayName](/docs/api/interfaces/Tool#displayname)). Omitted → byte-identical.

***

### effects?

> `readonly` `optional` **effects?**: `"read"`

Defined in: [src/tools/tools.ts:1171](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1171)

`'read'` — this tool changes nothing (see [Tool.effects](/docs/api/interfaces/Tool#effects)). Omitted →
 byte-identical.

***

### gates?

> `readonly` `optional` **gates?**: `boolean`

Defined in: [src/tools/tools.ts:1155](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1155)

Whether this tool's procedure can raise an approval gate — see
 [Tool.gates](/docs/api/interfaces/Tool#gates). Omitted → nothing declared, byte-identical.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/tools/tools.ts:1113](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1113)

***

### name

> `readonly` **name**: `string`

Defined in: [src/tools/tools.ts:1111](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1111)

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/tools/tools.ts:1116](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1116)

Declare a credential this tool needs (declare-and-push). Resolved by the
 framework before `execute` and injected as `ctx.credential`.

***

### owner?

> `readonly` `optional` **owner?**: `ToolOwner`

Defined in: [src/tools/tools.ts:1146](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1146)

The stamped identity edge — see [Tool.owner](/docs/api/interfaces/Tool#owner).

***

### period?

> `readonly` `optional` **period?**: [`ToolPeriod`](/docs/api/interfaces/ToolPeriod)

Defined in: [src/tools/tools.ts:1165](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1165)

Which argument sets the period the answer covers (see [Tool.period](/docs/api/interfaces/Tool#period)).
 Requires a rule on that argument. Omitted → byte-identical.

***

### repeatedWhen?

> `readonly` `optional` **repeatedWhen?**: `"arguments"`

Defined in: [src/tools/tools.ts:1159](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1159)

Fingerprint the repeated-call ledger on arguments alone, ignoring this
 tool's own result — see [Tool.repeatedWhen](/docs/api/interfaces/Tool#repeatedwhen). Omitted →
 byte-identical (the ledger keeps comparing results, as always).

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/docs/api/interfaces/ToolResultCeiling)

Defined in: [src/tools/tools.ts:1132](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1132)

Refuse (never truncate) a result over this many chars, teaching the model
 to narrow (see [ToolResultCeiling](/docs/api/interfaces/ToolResultCeiling)). Omitted → byte-identical.

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/docs/api/type-aliases/ToolResultClass)

Defined in: [src/tools/tools.ts:1136](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1136)

The declared class of this tool's results — `'triage'` or `'inventory'`
 (see [Tool.resultClass](/docs/api/interfaces/Tool#resultclass)). Keys the `check:semantics` per-class
 rules. Omitted → no class rules.

***

### resultColumns?

> `readonly` `optional` **resultColumns?**: `Readonly`\<`Record`\<`string`, [`ColumnType`](/docs/api/type-aliases/ColumnType) \| [`ColumnDeclaration`](/docs/api/interfaces/ColumnDeclaration)\>\>

Defined in: [src/tools/tools.ts:1144](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1144)

What this tool's ROWS contain — column name to type (see
 [Tool.resultColumns](/docs/api/interfaces/Tool#resultcolumns)). Needs the `checkColumnTypes` dial too.
 Omitted → nothing measured, byte-identical.

***

### resultKind?

> `readonly` `optional` **resultKind?**: `string`

Defined in: [src/tools/tools.ts:1140](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1140)

The artifact kind a PLACED result is minted under, in the consumer's
 vocabulary (see [Tool.resultKind](/docs/api/interfaces/Tool#resultkind)). Omitted →
 `tool-result/<name>`, byte-identical.

***

### script?

> `readonly` `optional` **script?**: [`ToolScript`](/docs/api/interfaces/ToolScript)

Defined in: [src/tools/tools.ts:1175](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1175)

This tool runs a program, carried by the one string argument `argument`
 (see [Tool.script](/docs/api/interfaces/Tool#script)). Refused here when that argument is not a
 declared string property. Omitted → byte-identical.

***

### search?

> `readonly` `optional` **search?**: [`ToolSearch`](/docs/api/interfaces/ToolSearch)

Defined in: [src/tools/tools.ts:1168](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1168)

What one call of this tool searches, classified (see [Tool.search](/docs/api/interfaces/Tool#search)).
 Refused here when malformed. Omitted → byte-identical.

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/tools/tools.ts:1120](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1120)

Declare artifact arguments: arg name → required artifact kind (see
 [Tool.wants](/docs/api/interfaces/Tool#wants)). The model passes the `art_…` ref; the framework
 resolves it before `execute` and the handler reads the data.

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/tools/tools.ts:1179](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1179)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
