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

What an inner call passes: the agent's `permissionChecker` and before-tool
middleware, asked with its own arguments under its derived `toolCallId`
(`<outer>#inner-<n>`); what they refuse for a model call they refuse here,
by name, and the tool does not run. What it gets: the outer call's own
facts (credentials, signal, progress) with `hasArtifacts: false` — an inner
tool must not mint claim tickets competing with the composed answer's own.
A declared `needs` is resolved before the inner execute (fail-closed: a
service that requires interactive consent refuses by name — an inner call
cannot pause). Each call leaves one row in the run's `innerToolCalls` state.

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
