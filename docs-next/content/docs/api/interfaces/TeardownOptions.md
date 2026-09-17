---
title: TeardownOptions
---

# Interface: TeardownOptions

Defined in: [src/core/toolSessions.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/toolSessions.ts#L94)

What a tool says about the cleanup it is registering.

## Properties

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/core/toolSessions.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/toolSessions.ts#L106)

Dedup key within `(tool, scope)`. Omitted → the tool gets one registration
per scope, which is right for a tool that holds exactly one thing.

Derive it with [toolSessionKey](/docs/api/functions/toolSessionKey) rather than by hand: a key that is
narrower than the identity it isolates is the cross-binding bug, and a key
that is wider is a silent latency change.

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/core/toolSessions.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/toolSessions.ts#L112)

One free-form fact about what was opened (the language, the browser
 profile). Reported as-is; never a place for user data.

***

### runnerId?

> `readonly` `optional` **runnerId?**: `string`

Defined in: [src/core/toolSessions.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/core/toolSessions.ts#L109)

The adapter holding the resource — `CodeRunner.id`, say. Reported so a
 row names its backend instead of only its tool.

***

### scope?

> `readonly` `optional` **scope?**: [`TeardownScope`](/docs/api/type-aliases/TeardownScope)

Defined in: [src/core/toolSessions.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/toolSessions.ts#L97)

Default `'run'`. Refused by name when the door cannot honour it — see
 [ToolExecutionContext.teardownScopes](/docs/api/interfaces/ToolExecutionContext#teardownscopes).
