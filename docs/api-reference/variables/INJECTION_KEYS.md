[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / INJECTION\_KEYS

# Variable: INJECTION\_KEYS

> `const` **INJECTION\_KEYS**: `object`

Defined in: [src/conventions.ts:351](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/conventions.ts#L351)

Scope-key convention for context injections.

Each slot subflow writes its injections to a well-known scope key.
ContextRecorder observes writes to these keys to emit context.injected
events. Builders that mount slot subflows MUST write injections to the
corresponding key; this is the data-level contract between builder and
recorder.

## Type Declaration

### MESSAGES

> `readonly` **MESSAGES**: `"messagesInjections"` = `'messagesInjections'`

### SYSTEM\_PROMPT

> `readonly` **SYSTEM\_PROMPT**: `"systemPromptInjections"` = `'systemPromptInjections'`

### TOOLS

> `readonly` **TOOLS**: `"toolsInjections"` = `'toolsInjections'`
