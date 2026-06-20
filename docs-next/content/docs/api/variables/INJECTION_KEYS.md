---
title: INJECTION_KEYS
---

# Variable: INJECTION\_KEYS

> `const` **INJECTION\_KEYS**: `object`

Defined in: [src/conventions.ts:322](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/conventions.ts#L322)

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
