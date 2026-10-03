---
title: RunbookAsToolOptions
---

# Interface: RunbookAsToolOptions

Defined in: [src/core/runbook/types.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L170)

Everything `runbookAsTool` accepts. Smallest legal call:
 `{ name, description, procedure }` — and it still yields the spine.

## Properties

### argumentsFrom?

> `readonly` `optional` **argumentsFrom?**: readonly `string`[]

Defined in: [src/core/runbook/types.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L186)

***

### composedOf?

> `readonly` `optional` **composedOf?**: readonly `string`[]

Defined in: [src/core/runbook/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L189)

The named ingredient tools the procedure calls through `ctx.tools` —
 drift-checked at agent build.

***

### description

> `readonly` **description**: `string`

Defined in: [src/core/runbook/types.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L174)

REQUIRED — a description-less tool is invisible to the model.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/runbook/types.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L194)

Explicit input schema wins; otherwise the chart's `.contract()` input
 is lifted when it is a plain JSON-Schema object (a parseable schema —
 zod et al. — cannot be serialized for the model and falls back to the
 empty-object default).

***

### keepRecord?

> `readonly` `optional` **keepRecord?**: `boolean`

Defined in: [src/core/runbook/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L213)

Keep each invocation's inner record for `inspect_tool_run` descent.

***

### keepRecordLimit?

> `readonly` `optional` **keepRecordLimit?**: `number`

Defined in: [src/core/runbook/types.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L215)

Bounded LRU size for kept records (requires `keepRecord: true`).

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/runbook/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L172)

Tool name the LLM dispatches by.

***

### owner?

> `readonly` `optional` **owner?**: `ToolOwner`

Defined in: [src/core/runbook/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L183)

***

### presentation?

> `readonly` `optional` **presentation?**: [`RunbookPresentation`](/docs/api/type-aliases/RunbookPresentation)

Defined in: [src/core/runbook/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L205)

Who renders the rowset — see [RunbookPresentation](/docs/api/type-aliases/RunbookPresentation). Default
 `'prose'`; an unknown value is refused at definition, never read as the
 default (a mis-spelled dial that silently keeps working is a dial that
 cannot be trusted to have been set).

***

### procedure

> `readonly` **procedure**: [`RunbookProcedure`](/docs/api/type-aliases/RunbookProcedure)

Defined in: [src/core/runbook/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L176)

The procedure factory — see [RunbookProcedure](/docs/api/type-aliases/RunbookProcedure).

***

### recorders?

> `readonly` `optional` **recorders?**: readonly [`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)[]

Defined in: [src/core/runbook/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L211)

Observers attached to each invocation's fresh inner executor.

***

### redact?

> `readonly` `optional` **redact?**: [`RedactionPolicy`](/docs/api/interfaces/RedactionPolicy)

Defined in: [src/core/runbook/types.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L229)

Redaction policy for the inner run. One rule for everything the tool
 shows (9.89.1): the commit log is scrubbed at write time — and since
 footprintjs 9.19.0 (the floor from 9.89.2) so is every path that used to
 bypass it: a subflow's seed and merge-back, tracked reads, dot-path
 `fields`, the narrated `Input:` line — and the envelope's state, the
 walk's recording and the kept record are all served from footprintjs's
 redacted view through `servableSnapshot`, exactly as the substrate
 serves it. The last limit that view had — a subflow's own heap, which
 `servableSnapshot` refolded from its scrubbed history — is closed by
 footprintjs 9.20.0 (the floor from 9.89.3): nothing left the log
 carries that the served view does not scrub; the checkpoint is not a
 served view. See `FlowchartAsToolOptions.redact` for the two things it
 does not govern: the run's fold base and the resume checkpoint.

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/docs/api/interfaces/ToolResultCeiling)

Defined in: [src/core/runbook/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L184)

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/docs/api/type-aliases/ToolResultClass)

Defined in: [src/core/runbook/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L182)

***

### resultKind?

> `readonly` `optional` **resultKind?**: `string`

Defined in: [src/core/runbook/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L181)

Selects the envelope projection (`'verdict/*'` gets the rowset) AND is
 the artifact kind a placed result is minted under.

***

### rules?

> `readonly` `optional` **rules?**: [`RunbookRules`](/docs/api/interfaces/RunbookRules)

Defined in: [src/core/runbook/types.ts:198](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L198)

Rule provenance — see [RunbookRules](/docs/api/interfaces/RunbookRules).

***

### verdicts?

> `readonly` `optional` **verdicts?**: [`RunbookVerdictsOptions`](/docs/api/interfaces/RunbookVerdictsOptions)

Defined in: [src/core/runbook/types.ts:200](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L200)

The verdict projection's dials — see [RunbookVerdictsOptions](/docs/api/interfaces/RunbookVerdictsOptions).

***

### walk?

> `readonly` `optional` **walk?**: [`RunbookWalkOptions`](/docs/api/interfaces/RunbookWalkOptions)

Defined in: [src/core/runbook/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L207)

The walk policy — see [RunbookWalkOptions](/docs/api/interfaces/RunbookWalkOptions).

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/runbook/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L185)
