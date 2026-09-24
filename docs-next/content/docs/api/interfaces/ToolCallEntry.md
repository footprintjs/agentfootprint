---
title: ToolCallEntry
---

# Interface: ToolCallEntry

Defined in: [src/adapters/types.ts:714](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L714)

One entry in the in-flight tool-call sequence delivered to
`PermissionChecker.check()` since v2.12. Lets sequence-aware
policies (exfil chain detection, idempotency limits, cost guards)
inspect what the agent has already dispatched this run.

Derived from `scope.history` at check time — single source of truth,
survives `agent.resumeOnError(checkpoint)` correctly.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [src/adapters/types.ts:718](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L718)

Tool args passed to `tool.execute(args, ctx)`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/adapters/types.ts:720](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L720)

ReAct iteration the call was dispatched on.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:716](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L716)

Tool name dispatched.

***

### providerId?

> `readonly` `optional` **providerId?**: `string`

Defined in: [src/adapters/types.ts:727](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L727)

Optional source identifier — `'local'` for tools registered via
`.tool(...)` / `staticTools(...)`, or the `ToolProvider.id` for
tools resolved through a `discoveryProvider`. Lets cross-hub
exfil rules match on origin, not just name.
