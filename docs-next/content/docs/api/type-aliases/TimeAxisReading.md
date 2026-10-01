---
title: TimeAxisReading
---

# Type Alias: TimeAxisReading

> **TimeAxisReading** = \{ `status`: `"absent"`; \} \| \{ `axis`: [`DatasetTimeAxis`](/docs/api/interfaces/DatasetTimeAxis); `status`: `"declared"`; \} \| \{ `issues`: readonly `string`[]; `status`: `"malformed"`; \}

Defined in: [src/core/time/axis.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/axis.ts#L222)

What a consumer finds on a ticket. `malformed` exists for tickets minted
 outside this library's put (a foreign writer, an old store) — a consumer
 shows it as an error, never as an undeclared dataset.
