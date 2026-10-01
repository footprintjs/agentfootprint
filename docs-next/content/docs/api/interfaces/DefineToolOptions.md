---
title: DefineToolOptions<TArgs, TResult>
---

# Interface: DefineToolOptions\<TArgs, TResult\>

Defined in: src/core/tools.ts:951

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

Defined in: src/core/tools.ts:989

The declared argument grounds — see [Tool.argumentsFrom](/docs/api/interfaces/Tool#argumentsfrom).

***

### askOrAssume?

> `readonly` `optional` **askOrAssume?**: `Readonly`\<`Record`\<`string`, `ArgumentRule`\>\>

Defined in: src/core/tools.ts:1003

Per-argument rules — what the library does when a call leaves an argument
 out (see [Tool.askOrAssume](/docs/api/interfaces/Tool#askorassume)). Omitted → byte-identical.

***

### capabilities?

> `readonly` `optional` **capabilities?**: readonly [`ToolCapability`](/docs/api/type-aliases/ToolCapability)[]

Defined in: src/core/tools.ts:970

Declare what this tool touches (see [Tool.capabilities](/docs/api/interfaces/Tool#capabilities)). Consulted
 only when the configured checker declares it governs them.

***

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/docs/api/type-aliases/CheckInDemand)\<`TArgs`\>

Defined in: src/core/tools.ts:964

Demand a human check-in before this tool runs (see [Tool.checkIn](/docs/api/interfaces/Tool#checkin)).
 `'always'` or a `(args, ctx) => boolean` predicate.

***

### checkInComponent?

> `readonly` `optional` **checkInComponent?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: src/core/tools.ts:967

The registered screen component that collects the check-in decision
 (see [Tool.checkInComponent](/docs/api/interfaces/Tool#checkincomponent)). Requires `checkIn`.

***

### composedOf?

> `readonly` `optional` **composedOf?**: readonly `string`[]

Defined in: src/core/tools.ts:993

The named ingredient tools this tool calls through `ctx.tools` — see
 [Tool.composedOf](/docs/api/interfaces/Tool#composedof). Drift-checked at agent build, when the catalog
 is complete. Omitted → nothing checked, byte-identical.

***

### description

> `readonly` **description**: `string`

Defined in: src/core/tools.ts:953

***

### gates?

> `readonly` `optional` **gates?**: `boolean`

Defined in: src/core/tools.ts:996

Whether this tool's procedure can raise an approval gate — see
 [Tool.gates](/docs/api/interfaces/Tool#gates). Omitted → nothing declared, byte-identical.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: src/core/tools.ts:954

***

### name

> `readonly` **name**: `string`

Defined in: src/core/tools.ts:952

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: src/core/tools.ts:957

Declare a credential this tool needs (declare-and-push). Resolved by the
 framework before `execute` and injected as `ctx.credential`.

***

### owner?

> `readonly` `optional` **owner?**: `ToolOwner`

Defined in: src/core/tools.ts:987

The stamped identity edge — see [Tool.owner](/docs/api/interfaces/Tool#owner).

***

### period?

> `readonly` `optional` **period?**: [`ToolPeriod`](/docs/api/interfaces/ToolPeriod)

Defined in: src/core/tools.ts:1006

Which argument sets the period the answer covers (see [Tool.period](/docs/api/interfaces/Tool#period)).
 Requires a rule on that argument. Omitted → byte-identical.

***

### repeatedWhen?

> `readonly` `optional` **repeatedWhen?**: `"arguments"`

Defined in: src/core/tools.ts:1000

Fingerprint the repeated-call ledger on arguments alone, ignoring this
 tool's own result — see [Tool.repeatedWhen](/docs/api/interfaces/Tool#repeatedwhen). Omitted →
 byte-identical (the ledger keeps comparing results, as always).

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/docs/api/interfaces/ToolResultCeiling)

Defined in: src/core/tools.ts:973

Refuse (never truncate) a result over this many chars, teaching the model
 to narrow (see [ToolResultCeiling](/docs/api/interfaces/ToolResultCeiling)). Omitted → byte-identical.

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/docs/api/type-aliases/ToolResultClass)

Defined in: src/core/tools.ts:977

The declared class of this tool's results — `'triage'` or `'inventory'`
 (see [Tool.resultClass](/docs/api/interfaces/Tool#resultclass)). Keys the `check:semantics` per-class
 rules. Omitted → no class rules.

***

### resultColumns?

> `readonly` `optional` **resultColumns?**: `Readonly`\<`Record`\<`string`, [`ColumnType`](/docs/api/type-aliases/ColumnType) \| [`ColumnDeclaration`](/docs/api/interfaces/ColumnDeclaration)\>\>

Defined in: src/core/tools.ts:985

What this tool's ROWS contain — column name to type (see
 [Tool.resultColumns](/docs/api/interfaces/Tool#resultcolumns)). Needs the `checkColumnTypes` dial too.
 Omitted → nothing measured, byte-identical.

***

### resultKind?

> `readonly` `optional` **resultKind?**: `string`

Defined in: src/core/tools.ts:981

The artifact kind a PLACED result is minted under, in the consumer's
 vocabulary (see [Tool.resultKind](/docs/api/interfaces/Tool#resultkind)). Omitted →
 `tool-result/<name>`, byte-identical.

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: src/core/tools.ts:961

Declare artifact arguments: arg name → required artifact kind (see
 [Tool.wants](/docs/api/interfaces/Tool#wants)). The model passes the `art_…` ref; the framework
 resolves it before `execute` and the handler reads the data.

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: src/core/tools.ts:1007

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
