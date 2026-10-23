---
title: DeclaredToolAbsence
---

# Type Alias: DeclaredToolAbsence

> **DeclaredToolAbsence** = `Omit`\<[`ToolAbsence`](/docs/api/interfaces/ToolAbsence), `"checked"`\> & `object`

Defined in: [src/semantics/coverage/types.ts:320](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L320)

The envelope `absent({ checked: 'declared' })` mints, before the dispatch
funnel composes its coverage. `readAbsence` does not read it (its `checked`
is not a list), so every reader that predates it sees data;
`recognize.ts` · `readDeclaredAbsence` is its one recognizer.

## Type Declaration

### checked

> `readonly` **checked**: `"declared"`
