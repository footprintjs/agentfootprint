---
title: ToolCallEntry
---

# Interface: ToolCallEntry

Defined in: [src/provider-contract/types.ts:770](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L770)

One entry in the in-flight tool-call sequence delivered to
`PermissionChecker.check()` since v2.12. Lets sequence-aware
policies (exfil chain detection, idempotency limits, cost guards)
inspect what the agent has already dispatched this run.

Derived from `scope.history` at check time — single source of truth,
survives `agent.resumeOnError(checkpoint)` correctly.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [src/provider-contract/types.ts:774](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L774)

Tool args passed to `tool.execute(args, ctx)`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/provider-contract/types.ts:776](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L776)

ReAct iteration the call was dispatched on.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:772](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L772)

Tool name dispatched.

***

### providerId?

> `readonly` `optional` **providerId?**: `string`

Defined in: [src/provider-contract/types.ts:783](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L783)

Optional source identifier — `'local'` for tools registered via
`.tool(...)` / `staticTools(...)`, or the `ToolProvider.id` for
tools resolved through a `discoveryProvider`. Lets cross-hub
exfil rules match on origin, not just name.
