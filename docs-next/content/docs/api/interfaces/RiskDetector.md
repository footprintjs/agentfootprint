---
title: "~~Interface: RiskDetector~~"
---

# ~~Interface: RiskDetector~~

Defined in: [src/adapters/types.ts:629](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L629)

## Deprecated

**Nothing implements or calls this, and nothing ever has.**
No guardrail stage consults a `RiskDetector`, so implementing one buys
no enforcement whatsoever — the most dangerous kind of dead port, since
a "risk detector" that is never asked looks from the outside exactly
like one that has found nothing. Removed in 10.0.0.

The seams that DO gate a run: `PermissionChecker` (tool-call
authorization, `agentfootprint/security`), `.reliability({ preCheck })`
(rules evaluated before the LLM call, `agentfootprint/resilience`), and
`.toolMiddleware(...)` (wrap or refuse a dispatch). For content
screening, run your own check inside a tool's `execute` or in a message
middleware and refuse there.

## Properties

### ~~name~~

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:630](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L630)

## Methods

### ~~check()~~

> **check**(`content`, `context`): `Promise`\<[`RiskResult`](/docs/api/interfaces/RiskResult)\>

Defined in: [src/adapters/types.ts:631](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L631)

#### Parameters

##### content

`string`

##### context

[`RiskContext`](/docs/api/interfaces/RiskContext)

#### Returns

`Promise`\<[`RiskResult`](/docs/api/interfaces/RiskResult)\>
