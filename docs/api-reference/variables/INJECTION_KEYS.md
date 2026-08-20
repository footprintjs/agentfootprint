[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / INJECTION\_KEYS

# Variable: INJECTION\_KEYS

> `const` **INJECTION\_KEYS**: `object`

Defined in: [src/conventions.ts:457](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/conventions.ts#L457)

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
