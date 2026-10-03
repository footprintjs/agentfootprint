---
title: CodeRunnerToolScope
---

# Type Alias: CodeRunnerToolScope

> **CodeRunnerToolScope** = `Extract`\<[`TeardownScope`](/docs/api/type-aliases/TeardownScope), `"call"` \| `"run"` \| `"session"`\>

Defined in: src/core/codeRunnerTool.ts:66

The scopes a code session can be held under. `'shutdown'` is not one: it is
 when everything goes, not a thing to key a session on.
