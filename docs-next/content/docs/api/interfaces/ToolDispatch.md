---
title: ToolDispatch
---

# Interface: ToolDispatch

Defined in: [src/core/tools.ts:668](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L668)

The run's own tool dispatch, delivered at execute time as `ctx.tools`
(9.76.0) — how one tool's body calls ANOTHER registered tool through the
same map the model dispatches by, instead of importing its module and
building a second query stack.

What it sees: the agent's static catalog (`.tool()` registrations plus
skill-carried tools) — the same dispatch map the tool-calls handler uses.
Tools delivered by a `ToolProvider` are NOT visible (there is no build-time
list), a stated caveat, not an accident.

What an inner call gets: the outer call's own facts (credentials, signal,
progress) with `hasArtifacts: false` — an inner tool must not mint claim
tickets competing with the composed answer's own — and a derived
`toolCallId` naming the outer call it belongs to. A declared `needs` is
resolved before the inner execute (fail-closed: a service that requires
interactive consent refuses by name — an inner call cannot pause).

## Methods

### call()

> **call**(`name`, `args`, `opts?`): `Promise`\<`unknown`\>

Defined in: [src/core/tools.ts:675](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L675)

Execute a registered tool and return its result exactly as returned —
a coverage envelope arrives as the envelope, an absence as the absence.

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

Defined in: [src/core/tools.ts:670](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L670)

Is this name in the dispatch map? Provider-delivered tools answer false.

#### Parameters

##### name

`string`

#### Returns

`boolean`
