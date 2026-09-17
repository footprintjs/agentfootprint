---
title: ToolResultColumns
---

# Type Alias: ToolResultColumns

> **ToolResultColumns** = `Readonly`\<`Record`\<`string`, [`ColumnType`](/docs/api/type-aliases/ColumnType) \| [`ColumnDeclaration`](/docs/api/interfaces/ColumnDeclaration)\>\>

Defined in: [src/integrity/column-types/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/types.ts#L97)

What a tool declares about the columns of its rowset — column name to type.

OPEN, NEVER CLOSED. A declaration is a promise about what it NAMES, not a
schema of everything the result may contain: a column nobody listed is
allowed and is never judged. Two reasons, and both are the same reason.

  • A closed schema punishes the wrong party. The day the backend adds a
    column, every one of these tools starts filing findings about a change
    that broke nothing — and a check that cries about correct behaviour is
    a check people switch off, which is how the failure it exists to catch
    gets back in.
  • It is the rule the neighbouring boundary already keeps.
    `toolArgsValidation` is permissive on keywords it does not know and
    enforces `additionalProperties: false` only when an author explicitly
    asks for it. Two validators at one seam disagreeing about whether
    silence means "allowed" would be a worse defect than either could
    catch.
