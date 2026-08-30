---
title: runbookAsTool
---

# Function: runbookAsTool()

> **runbookAsTool**(`opts`): [`Tool`](/docs/api/interfaces/Tool)

Defined in: [src/core/runbook/runbookAsTool.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/runbookAsTool.ts#L179)

Wrap a footprintjs procedure as a `Tool` whose every answer carries the
honesty spine. See the module header for the envelope; see
[RunbookAsToolOptions](/docs/api/interfaces/RunbookAsToolOptions) for the full options bag. The smallest legal
call is `{ name, description, procedure }`.

## Parameters

### opts

[`RunbookAsToolOptions`](/docs/api/interfaces/RunbookAsToolOptions)

## Returns

[`Tool`](/docs/api/interfaces/Tool)
