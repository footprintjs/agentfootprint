---
title: RedactionReport
---

# Interface: RedactionReport

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:127

State redaction report. Never includes values; emit and diagnostic
selectors/activity are not represented here.

## Properties

### fieldRedactions

> **fieldRedactions**: `Record`\<`string`, `string`[]\>

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:131

Keys with field-level redaction → which fields were scrubbed.

***

### patterns

> **patterns**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:133

Pattern sources that were active (e.g. ['password|secret']).

***

### redactedKeys

> **redactedKeys**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:129

Keys fully redacted (exact match or pattern match).
