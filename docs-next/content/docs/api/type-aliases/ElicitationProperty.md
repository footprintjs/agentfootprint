---
title: ElicitationProperty
---

# Type Alias: ElicitationProperty

> **ElicitationProperty** = \{ `description?`: `string`; `enum?`: readonly `string`[]; `enumNames?`: readonly `string`[]; `format?`: `"date-time"`; `type`: `"string"`; \} \| \{ `description?`: `string`; `type`: `"number"`; \} \| \{ `description?`: `string`; `type`: `"boolean"`; \}

Defined in: [src/lib/mcp/elicitation.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/mcp/elicitation.ts#L57)

One primitive property of an elicitation's `requestedSchema`.
