---
title: ToolCallEntry
---

# Interface: ToolCallEntry

Defined in: [src/adapters/types.ts:743](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L743)

One entry in the in-flight tool-call sequence delivered to
`PermissionChecker.check()` since v2.12. Lets sequence-aware
policies (exfil chain detection, idempotency limits, cost guards)
inspect what the agent has already dispatched this run.

Derived from `scope.history` at check time — single source of truth,
survives `agent.resumeOnError(checkpoint)` correctly.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [src/adapters/types.ts:747](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L747)

Tool args passed to `tool.execute(args, ctx)`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/adapters/types.ts:749](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L749)

ReAct iteration the call was dispatched on.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:745](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L745)

Tool name dispatched.

***

### providerId?

> `readonly` `optional` **providerId?**: `string`

Defined in: [src/adapters/types.ts:756](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L756)

Optional source identifier — `'local'` for tools registered via
`.tool(...)` / `staticTools(...)`, or the `ToolProvider.id` for
tools resolved through a `discoveryProvider`. Lets cross-hub
exfil rules match on origin, not just name.
