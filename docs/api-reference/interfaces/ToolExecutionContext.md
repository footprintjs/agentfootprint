[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolExecutionContext

# Interface: ToolExecutionContext

Defined in: [src/core/tools.ts:67](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/tools.ts#L67)

Runtime context passed to tool.execute().

## Properties

### credential?

> `readonly` `optional` **credential?**: `Credential`

Defined in: [src/core/tools.ts:86](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/tools.ts#L86)

The credential resolved for this tool's declared `needs` (declare-and-push).
 Present only when the tool declared a need and it resolved successfully.

***

### credentials

> `readonly` **credentials**: `CredentialProvider`

Defined in: [src/core/tools.ts:80](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/tools.ts#L80)

The bound credential provider — the PULL escape hatch for dynamic needs.
Always present: when none is attached it's a fail-closed provider that
THROWS, so it never silently no-ops via optional chaining. Prefer the
declarative `needs` + `ctx.credential` for the common case.

***

### hasCredentials

> `readonly` **hasCredentials**: `boolean`

Defined in: [src/core/tools.ts:83](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/tools.ts#L83)

True when a real provider is attached. Branch on this for intentional
 degraded (no-credential) mode instead of relying on `undefined`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/tools.ts:71](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/tools.ts#L71)

Current iteration number of the ReAct loop.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/tools.ts:73](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/tools.ts#L73)

Abort signal propagated from run({ env: { signal } }).

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/tools.ts:69](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/tools.ts#L69)

Unique id of THIS tool invocation (matches stream.tool_start.toolCallId).
