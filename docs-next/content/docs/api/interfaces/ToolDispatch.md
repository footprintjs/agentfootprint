---
title: ToolDispatch
---

# Interface: ToolDispatch

Defined in: [src/tools/tools.ts:838](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L838)

The run's own tool dispatch, delivered at execute time as `ctx.tools`
(9.76.0) — how one tool's body calls ANOTHER registered tool through the
same map the model dispatches by, instead of importing its module and
building a second query stack.

What it sees: the agent's static catalog (`.tool()` registrations plus
skill-carried tools) — the same dispatch map the tool-calls handler uses.
Tools delivered by a `ToolProvider` are NOT visible (there is no build-time
list), a stated caveat, not an accident.

What an inner call passes, in a model call's order, on ONE copy of `args`
taken when it is made: the agent's `permissionChecker` (its `sequence` holds
the earlier inner calls that ran; a `halt` ends the run once the outer call
settles) and before-tool middleware, under its derived `toolCallId`
(`<outer>#inner-<n>`); what they refuse for a model call they refuse here, by
name. It gets the outer call's facts with `hasArtifacts: false` (an inner
tool must not mint claim tickets competing with the composed answer's own);
`needs` resolves fail-closed (an inner call cannot pause). A `ctx.tools` used after
its outer `execute` settled refuses. Each call leaves an `innerToolCalls` row.

## Methods

### call()

> **call**(`name`, `args`, `opts?`): `Promise`\<`unknown`\>

Defined in: [src/tools/tools.ts:842](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L842)

Run a registered tool; its result comes back exactly as returned (an absence as the absence).

#### Parameters

##### name

`string`

##### args

`unknown`

##### opts?

[`ToolDispatchCallOptions`](/docs/api/interfaces/ToolDispatchCallOptions)

#### Returns

`Promise`\<`unknown`\>

***

### has()

> **has**(`name`): `boolean`

Defined in: [src/tools/tools.ts:840](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L840)

Is this name in the dispatch map? Provider-delivered tools answer false.

#### Parameters

##### name

`string`

#### Returns

`boolean`
