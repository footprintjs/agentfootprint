---
title: ToolResultRowsetSource
---

# Type Alias: ToolResultRowsetSource

> **ToolResultRowsetSource** = \{ `kind`: `"inline"`; `path`: readonly `string`[]; \} \| \{ `artifactKind`: `string`; `kind`: `"published-dataset"`; `maxBytes`: `number`; `maxRows`: `number`; `refPath`: readonly `string`[]; \}

Defined in: [src/tools/resultRowsets.ts:7](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/resultRowsets.ts#L7)

The final governed payload is addressed explicitly; no preview or historical fallback.
