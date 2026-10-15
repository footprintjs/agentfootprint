---
type: added
---
**Memory write options: skip long-term extraction, and a namespace per tenant.** The `MemoryStore` port's writes (`put`, `putMany`, `putIfVersion`) take an optional third argument with two vendor-neutral options, and `defineMemory({ writeOptions })` applies them to every write a memory makes:

- `extraction: 'skip'` — store the entry, but keep it out of the service's long-term extraction (no fact, summary or preference is derived from it);
- `namespaceScope` — the values the service puts into the namespaces its derived records are filed under: fixed, or `(identity) => ({ tenantid: … })` for one per tenant.

`AgentCoreStore` honours both, as `CreateEvent`'s own fields: `extractionMode: 'SKIP'` and `extractionConfig.namespaceVariables`. Every other store refuses them **by name** (`UnsupportedMemoryWriteOptionError`) before writing anything, never ignoring them: a dropped namespace would file one tenant's derived records where another's are read. A store declares what it honours in the new `MemoryStore.writeOptions`, and `defineMemory` checks it before the first turn. A custom `AgentCoreLikeClient` must declare `forwardsWriteOptions: true`; a third-party store can refuse in the same words with `refuseUnhonouredWriteOptions`. Writes without options are unchanged.
