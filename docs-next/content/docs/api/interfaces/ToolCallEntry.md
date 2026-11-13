---
title: ToolCallEntry
---

# Interface: ToolCallEntry

Defined in: [src/provider-contract/types.ts:796](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L796)

One entry in the in-flight tool-call sequence delivered to
`PermissionChecker.check()` since v2.12. Lets sequence-aware
policies (exfil chain detection, idempotency limits, cost guards)
inspect what the agent has already dispatched this run.

Derived from `scope.history` at check time — single source of truth,
survives `agent.resumeOnError(checkpoint)` correctly.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [src/provider-contract/types.ts:800](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L800)

Tool args passed to `tool.execute(args, ctx)`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/provider-contract/types.ts:802](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L802)

ReAct iteration the call was dispatched on.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:798](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L798)

Tool name dispatched.

***

### providerId?

> `readonly` `optional` **providerId?**: `string`

Defined in: [src/provider-contract/types.ts:809](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L809)

Optional source identifier — `'local'` for tools registered via
`.tool(...)` / `staticTools(...)`, or the `ToolProvider.id` for
tools resolved through a `discoveryProvider`. Lets cross-hub
exfil rules match on origin, not just name.
