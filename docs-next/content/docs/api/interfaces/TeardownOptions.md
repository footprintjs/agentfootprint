---
title: TeardownOptions
---

# Interface: TeardownOptions

Defined in: [src/tools/toolSessions/contracts.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/toolSessions/contracts.ts#L35)

What a tool says about the cleanup it is registering.

## Properties

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/tools/toolSessions/contracts.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/toolSessions/contracts.ts#L49)

Dedup key within `(tool, scope, key)`: session rows are additionally isolated
by tenant/principal/session; shutdown rows are process-wide for this tier.
Call and run rows also retain their native owner. Omitted → one registration
per tool and scope within that boundary.

Derive it with [toolSessionKey](/docs/api/functions/toolSessionKey) rather than by hand: a key that is
narrower than the identity it isolates is the cross-binding bug, and a key
that is wider is a silent latency change.

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/tools/toolSessions/contracts.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/toolSessions/contracts.ts#L55)

One free-form fact about what was opened (the language, the browser
 profile). Reported as-is; never a place for user data.

***

### runnerId?

> `readonly` `optional` **runnerId?**: `string`

Defined in: [src/tools/toolSessions/contracts.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/toolSessions/contracts.ts#L52)

The adapter holding the resource — `CodeRunner.id`, say. Reported so a
 row names its backend instead of only its tool.

***

### scope?

> `readonly` `optional` **scope?**: [`TeardownScope`](/docs/api/type-aliases/TeardownScope)

Defined in: [src/tools/toolSessions/contracts.ts:38](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/toolSessions/contracts.ts#L38)

Default `'run'`. Refused by name when the door cannot honour it — see
 [ToolExecutionContext.teardownScopes](/docs/api/interfaces/ToolExecutionContext#teardownscopes).
