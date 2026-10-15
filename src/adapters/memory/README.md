**Support** — one adapter per backend behind the `MemoryStore` port.

## What it reads / what it writes
Persists and searches `MemoryEntry` rows, scoped by the identity tuple. What is
RECALLED from these rows is decided by `src/memory/retrieval/` (a Fold) and
worded by the memory formatters (a Lens) — never here.

## The one law here
The identity tuple is the tenant boundary; every call is scoped by it. A store
declares its own capabilities — search, and the write options it honours —
rather than being assumed to have them.

## Write options: honoured, or refused by name
A managed memory service EXTRACTS long-term records (facts, summaries,
preferences) from what it stores and files them under namespaces. Two things
about that are the caller's to decide per write, in names no vendor owns
(`src/memory/store/writeOptions.ts`):

- `extraction: 'skip'` — keep this write out of long-term extraction;
- `namespaceScope` — the namespace its derived records are filed under,
  typically one tenant's.

**Why it is strict.** A store that silently dropped `namespaceScope` would file
one tenant's derived records where another tenant's are read, and a dropped
`'skip'` turns a turn kept out of long-term memory into a remembered fact. Both
look exactly like working. So each store declares what it honours
(`writeOptions`) and refuses every other option BY NAME, before writing
anything (`refuseUnhonouredWriteOptions`); `defineMemory` checks the
declaration before any turn runs.

```ts
const memory = defineMemory({
  id: 'conversation',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store: new AgentCoreStore({ memoryId, region: 'us-west-2' }),
  writeOptions: {
    extraction: 'skip',
    // One namespace per tenant — keep the mapping one-to-one.
    namespaceScope: (identity) => ({ tenantid: tenantSlug(identity.tenant) }),
  },
});
// or per write, on the port:  store.put(identity, entry, { extraction: 'skip' })
```

The strategy per adapter:

| Store | `extraction: 'skip'` | `namespaceScope` |
|---|---|---|
| `AgentCoreStore` | honoured → `CreateEvent.extractionMode: 'SKIP'` | honoured → `CreateEvent.extractionConfig.namespaceVariables` (AgentCore validates them) |
| `memoryBankStore` | refused — every write is itself a long-term memory | refused — the scope is `scopeFor(identity)`; a per-write one would hide the row from every retrieval |
| `InMemoryStore`, `RedisStore`, `sqliteVectorStore`, `pgVectorStore`, `s3VectorsStore` | refused — nothing is ever extracted | refused — no derived records; the identity tuple is the boundary |
| `staticVectorStore` | refused — every write is | refused — every write is |
| `BedrockAgentMemory` | no write port at all (Bedrock Agents owns the writes) | — |

An injected `AgentCoreLikeClient` must declare `forwardsWriteOptions: true` —
a client written before the fields existed would compile and drop them. An
empty batch stays a no-op, options or not (the port's law).

## Files
- `pgVector.ts`, `redis.ts`, `sqliteVector.ts`, `s3Vectors.ts` — durable stores.
- `agentcore.ts`, `bedrockAgentMemory.ts`, `memoryBank.ts` — hosted memory
  services behind the same port.
