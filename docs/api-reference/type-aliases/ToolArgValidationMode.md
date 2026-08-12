[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolArgValidationMode

# Type Alias: ToolArgValidationMode

> **ToolArgValidationMode** = `"enforce"` \| `"warn"` \| `"off"`

Defined in: [src/core/agent/toolArgsValidation.ts:37](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core/agent/toolArgsValidation.ts#L37)

When to enforce: 'enforce' rejects before dispatch (default), 'warn'
 emits the event but executes anyway, 'off' skips validation entirely.
