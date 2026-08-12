[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TeardownOptions

# Interface: TeardownOptions

Defined in: [src/core/toolSessions.ts:92](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/toolSessions.ts#L92)

What a tool says about the cleanup it is registering.

## Properties

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/core/toolSessions.ts:104](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/toolSessions.ts#L104)

Dedup key within `(tool, scope)`. Omitted → the tool gets one registration
per scope, which is right for a tool that holds exactly one thing.

Derive it with [toolSessionKey](/agentfootprint/api/generated/functions/toolSessionKey.md) rather than by hand: a key that is
narrower than the identity it isolates is the cross-binding bug, and a key
that is wider is a silent latency change.

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/core/toolSessions.ts:110](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/toolSessions.ts#L110)

One free-form fact about what was opened (the language, the browser
 profile). Reported as-is; never a place for user data.

***

### runnerId?

> `readonly` `optional` **runnerId?**: `string`

Defined in: [src/core/toolSessions.ts:107](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/toolSessions.ts#L107)

The adapter holding the resource — `CodeRunner.id`, say. Reported so a
 row names its backend instead of only its tool.

***

### scope?

> `readonly` `optional` **scope?**: [`TeardownScope`](/agentfootprint/api/generated/type-aliases/TeardownScope.md)

Defined in: [src/core/toolSessions.ts:95](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/toolSessions.ts#L95)

Default `'run'`. Refused by name when the door cannot honour it — see
 [ToolExecutionContext.teardownScopes](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md#teardownscopes).
