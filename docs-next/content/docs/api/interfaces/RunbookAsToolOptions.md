---
title: RunbookAsToolOptions
---

# Interface: RunbookAsToolOptions

Defined in: [src/core/runbook/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L161)

Everything `runbookAsTool` accepts. Smallest legal call:
 `{ name, description, procedure }` — and it still yields the spine.

## Properties

### argumentsFrom?

> `readonly` `optional` **argumentsFrom?**: readonly `string`[]

Defined in: [src/core/runbook/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L177)

***

### composedOf?

> `readonly` `optional` **composedOf?**: readonly `string`[]

Defined in: [src/core/runbook/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L180)

The named ingredient tools the procedure calls through `ctx.tools` —
 drift-checked at agent build.

***

### description

> `readonly` **description**: `string`

Defined in: [src/core/runbook/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L165)

REQUIRED — a description-less tool is invisible to the model.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/runbook/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L185)

Explicit input schema wins; otherwise the chart's `.contract()` input
 is lifted when it is a plain JSON-Schema object (a parseable schema —
 zod et al. — cannot be serialized for the model and falls back to the
 empty-object default).

***

### keepRecord?

> `readonly` `optional` **keepRecord?**: `boolean`

Defined in: [src/core/runbook/types.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L204)

Keep each invocation's inner record for `inspect_tool_run` descent.

***

### keepRecordLimit?

> `readonly` `optional` **keepRecordLimit?**: `number`

Defined in: [src/core/runbook/types.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L206)

Bounded LRU size for kept records (requires `keepRecord: true`).

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/runbook/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L163)

Tool name the LLM dispatches by.

***

### owner?

> `readonly` `optional` **owner?**: `ToolOwner`

Defined in: [src/core/runbook/types.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L174)

***

### presentation?

> `readonly` `optional` **presentation?**: [`RunbookPresentation`](/docs/api/type-aliases/RunbookPresentation)

Defined in: [src/core/runbook/types.ts:196](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L196)

Who renders the rowset — see [RunbookPresentation](/docs/api/type-aliases/RunbookPresentation). Default
 `'prose'`; an unknown value is refused at definition, never read as the
 default (a mis-spelled dial that silently keeps working is a dial that
 cannot be trusted to have been set).

***

### procedure

> `readonly` **procedure**: [`RunbookProcedure`](/docs/api/type-aliases/RunbookProcedure)

Defined in: [src/core/runbook/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L167)

The procedure factory — see [RunbookProcedure](/docs/api/type-aliases/RunbookProcedure).

***

### recorders?

> `readonly` `optional` **recorders?**: readonly [`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)[]

Defined in: [src/core/runbook/types.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L202)

Observers attached to each invocation's fresh inner executor.

***

### redact?

> `readonly` `optional` **redact?**: [`RedactionPolicy`](/docs/api/interfaces/RedactionPolicy)

Defined in: [src/core/runbook/types.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L208)

Redaction policy for the inner run (commit-time scrub).

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/docs/api/interfaces/ToolResultCeiling)

Defined in: [src/core/runbook/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L175)

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/docs/api/type-aliases/ToolResultClass)

Defined in: [src/core/runbook/types.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L173)

***

### resultKind?

> `readonly` `optional` **resultKind?**: `string`

Defined in: [src/core/runbook/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L172)

Selects the envelope projection (`'verdict/*'` gets the rowset) AND is
 the artifact kind a placed result is minted under.

***

### rules?

> `readonly` `optional` **rules?**: [`RunbookRules`](/docs/api/interfaces/RunbookRules)

Defined in: [src/core/runbook/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L189)

Rule provenance — see [RunbookRules](/docs/api/interfaces/RunbookRules).

***

### verdicts?

> `readonly` `optional` **verdicts?**: [`RunbookVerdictsOptions`](/docs/api/interfaces/RunbookVerdictsOptions)

Defined in: [src/core/runbook/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L191)

The verdict projection's dials — see [RunbookVerdictsOptions](/docs/api/interfaces/RunbookVerdictsOptions).

***

### walk?

> `readonly` `optional` **walk?**: [`RunbookWalkOptions`](/docs/api/interfaces/RunbookWalkOptions)

Defined in: [src/core/runbook/types.ts:198](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L198)

The walk policy — see [RunbookWalkOptions](/docs/api/interfaces/RunbookWalkOptions).

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/runbook/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L176)
