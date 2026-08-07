[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolCallEntry

# Interface: ToolCallEntry

Defined in: [src/adapters/types.ts:527](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/adapters/types.ts#L527)

One entry in the in-flight tool-call sequence delivered to
`PermissionChecker.check()` since v2.12. Lets sequence-aware
policies (exfil chain detection, idempotency limits, cost guards)
inspect what the agent has already dispatched this run.

Derived from `scope.history` at check time — single source of truth,
survives `agent.resumeOnError(checkpoint)` correctly.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [src/adapters/types.ts:531](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/adapters/types.ts#L531)

Tool args passed to `tool.execute(args, ctx)`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/adapters/types.ts:533](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/adapters/types.ts#L533)

ReAct iteration the call was dispatched on.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:529](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/adapters/types.ts#L529)

Tool name dispatched.

***

### providerId?

> `readonly` `optional` **providerId?**: `string`

Defined in: [src/adapters/types.ts:540](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/adapters/types.ts#L540)

Optional source identifier — `'local'` for tools registered via
`.tool(...)` / `staticTools(...)`, or the `ToolProvider.id` for
tools resolved through a `discoveryProvider`. Lets cross-hub
exfil rules match on origin, not just name.
