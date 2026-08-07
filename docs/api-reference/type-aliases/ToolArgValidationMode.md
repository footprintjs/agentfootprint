[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolArgValidationMode

# Type Alias: ToolArgValidationMode

> **ToolArgValidationMode** = `"enforce"` \| `"warn"` \| `"off"`

Defined in: [src/core/agent/toolArgsValidation.ts:37](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/toolArgsValidation.ts#L37)

When to enforce: 'enforce' rejects before dispatch (default), 'warn'
 emits the event but executes anyway, 'off' skips validation entirely.
