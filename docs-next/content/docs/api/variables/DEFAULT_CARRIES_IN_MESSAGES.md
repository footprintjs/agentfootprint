---
title: DEFAULT_CARRIES_IN_MESSAGES
---

# Variable: DEFAULT\_CARRIES\_IN\_MESSAGES

> `const` **DEFAULT\_CARRIES\_IN\_MESSAGES**: readonly [`WireRole`](/docs/api/type-aliases/WireRole)[]

Defined in: [src/adapters/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L137)

The floor every known wire supports. Used for any provider that does not
declare `carriesInMessages` — a third-party adapter is assumed to carry
only what all of them do, never more.
