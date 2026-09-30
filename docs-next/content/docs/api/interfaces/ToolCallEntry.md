---
title: ToolCallEntry
---

# Interface: ToolCallEntry

Defined in: [src/adapters/types.ts:775](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L775)

One entry in the in-flight tool-call sequence delivered to
`PermissionChecker.check()` since v2.12. Lets sequence-aware
policies (exfil chain detection, idempotency limits, cost guards)
inspect what the agent has already dispatched this run.

Derived from `scope.history` at check time — single source of truth,
survives `agent.resumeOnError(checkpoint)` correctly.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [src/adapters/types.ts:779](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L779)

Tool args passed to `tool.execute(args, ctx)`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/adapters/types.ts:781](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L781)

ReAct iteration the call was dispatched on.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:777](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L777)

Tool name dispatched.

***

### providerId?

> `readonly` `optional` **providerId?**: `string`

Defined in: [src/adapters/types.ts:788](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L788)

Optional source identifier — `'local'` for tools registered via
`.tool(...)` / `staticTools(...)`, or the `ToolProvider.id` for
tools resolved through a `discoveryProvider`. Lets cross-hub
exfil rules match on origin, not just name.
