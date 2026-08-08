[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolArgValidationMode

# Type Alias: ToolArgValidationMode

> **ToolArgValidationMode** = `"enforce"` \| `"warn"` \| `"off"`

Defined in: [src/core/agent/toolArgsValidation.ts:37](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/toolArgsValidation.ts#L37)

When to enforce: 'enforce' rejects before dispatch (default), 'warn'
 emits the event but executes anyway, 'off' skips validation entirely.
