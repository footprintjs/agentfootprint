[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / INJECTION\_KEYS

# Variable: INJECTION\_KEYS

> `const` **INJECTION\_KEYS**: `object`

Defined in: [agentfootprint/src/conventions.ts:99](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/conventions.ts#L99)

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
