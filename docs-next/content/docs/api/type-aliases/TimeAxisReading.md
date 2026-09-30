---
title: TimeAxisReading
---

# Type Alias: TimeAxisReading

> **TimeAxisReading** = \{ `status`: `"absent"`; \} \| \{ `axis`: [`DatasetTimeAxis`](/docs/api/interfaces/DatasetTimeAxis); `status`: `"declared"`; \} \| \{ `issues`: readonly `string`[]; `status`: `"malformed"`; \}

Defined in: src/artifacts/timeAxis.ts:197

What a consumer finds on a ticket. `malformed` exists for tickets minted
 outside this library's put (a foreign writer, an old store) — a consumer
 shows it as an error, never as an undeclared dataset.
