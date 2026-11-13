---
title: DEFAULT_CARRIES_IN_MESSAGES
---

# Variable: DEFAULT\_CARRIES\_IN\_MESSAGES

> `const` **DEFAULT\_CARRIES\_IN\_MESSAGES**: readonly [`WireRole`](/docs/api/type-aliases/WireRole)[]

Defined in: [src/provider-contract/types.ts:256](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L256)

The floor every known wire supports. Used for any provider that does not
declare `carriesInMessages` — a third-party adapter is assumed to carry
only what all of them do, never more.
