---
title: NegativeClaimsOptions
---

# Type Alias: NegativeClaimsOptions

> **NegativeClaimsOptions** = \{ `field`: `string`; `prose?`: `never`; `tools`: readonly `string`[]; `unestablished?`: `"withhold"` \| `"state-searched"`; \} \| \{ `field?`: `never`; `prose`: `true`; `tools?`: `never`; `unestablished?`: `never`; \} & `object`

Defined in: [src/core/agent/negativeClaims/config.ts:26](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L26)

Configure typed library-written statements or observe ordinary answer prose.
`{ prose: true }` needs no schema or tool list and never rewrites or blocks an answer.
Both modes can add bounded literal phrase data; prose findings remain unverified.

In the typed arm, the named field must be a required, top-level array in the output JSON Schema.
Every cited tool must be registered locally. A search declaration or an admitted
`absent({ among })` result supplies its coverage at runtime.

Typed enforcement is available, but not recommended until its benchmark gates pass.
Model prose is observed with a bounded grammar; it remains unchecked.
Prose enforcement is unavailable.

## Type Declaration

### phrases?

> `readonly` `optional` **phrases?**: [`NegativeClaimPhraseExtensions`](/docs/api/interfaces/NegativeClaimPhraseExtensions)

Optional bounded literal phrases. They only add observations, never verification or enforcement.
