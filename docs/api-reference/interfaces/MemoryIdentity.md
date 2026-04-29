[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MemoryIdentity

# Interface: MemoryIdentity

Defined in: [agentfootprint/src/memory/identity/types.ts:22](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/identity/types.ts#L22)

MemoryIdentity — hierarchical scoping for everything memory-related.

The library enforces isolation at every storage call: no cross-tenant
reads, no cross-principal writes, period. Enterprise deploys (Azure Entra,
AWS SSO, etc.) surface tenant + principal from the incoming request;
simpler deploys just use `conversationId`.

Why three fields instead of one "key"?
  - `tenant`     — organization / workspace / account boundary
  - `principal`  — user / service-account identity within the tenant
  - `conversationId` — a single thread / session for that principal

Storage adapters prefix namespaces with the full identity tuple. A bug in
a multi-tenant app that passes the wrong `tenant` can't accidentally read
another customer's memory — the tuple mismatch surfaces as "no data"
rather than a silent leak.

Fields after `conversationId` are reserved for future expansion (agent id,
role, etc.) without breaking existing stores.

## Properties

### conversationId

> `readonly` **conversationId**: `string`

Defined in: [agentfootprint/src/memory/identity/types.ts:40](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/identity/types.ts#L40)

Required — the conversation / session / thread id. Stable across
multiple `agent.run()` calls so history accumulates correctly.

***

### principal?

> `readonly` `optional` **principal?**: `string`

Defined in: [agentfootprint/src/memory/identity/types.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/identity/types.ts#L34)

Optional user / service-account identity within the tenant. Isolates
memory per end-user inside a shared tenant.

***

### tenant?

> `readonly` `optional` **tenant?**: `string`

Defined in: [agentfootprint/src/memory/identity/types.ts:28](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/identity/types.ts#L28)

Optional organization / workspace / account boundary. Omit for
single-tenant deploys. Storage adapters MUST refuse cross-tenant reads
when this field is set.
