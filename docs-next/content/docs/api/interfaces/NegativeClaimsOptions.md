---
title: NegativeClaimsOptions
---

# Interface: NegativeClaimsOptions

Defined in: [src/core/agent/negativeClaims/config.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L17)

Configure library-written statements for a typed answer's negative citations.
The named field must be a required, top-level array in the output JSON Schema.
Every cited tool must be registered locally. A search declaration or an admitted
`absent({ among })` result supplies its coverage at runtime.

Available, but not recommended until the typed benchmark gates pass. Model prose is observed with a bounded grammar; it remains unchecked.
Prose enforcement is unavailable.

## Properties

### field

> `readonly` **field**: `string`

Defined in: [src/core/agent/negativeClaims/config.ts:18](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L18)

***

### tools

> `readonly` **tools**: readonly `string`[]

Defined in: [src/core/agent/negativeClaims/config.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L19)

***

### unestablished?

> `readonly` `optional` **unestablished?**: `"withhold"` \| `"state-searched"`

Defined in: [src/core/agent/negativeClaims/config.ts:21](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/negativeClaims/config.ts#L21)

Default `withhold`. `state-searched` reports what was read without upgrading its verdict.
