**Support** — one adapter per backend behind the `MemoryStore` port.

## What it reads / what it writes
Persists and searches `MemoryEntry` rows, scoped by the identity tuple. What is
RECALLED from these rows is decided by `src/memory/retrieval/` (a Fold) and
worded by the memory formatters (a Lens) — never here.

## The one law here
The identity tuple is the tenant boundary; every call is scoped by it. A store
declares its own search capabilities rather than being assumed to have them.

## Files
- `pgVector.ts`, `redis.ts`, `sqliteVector.ts`, `s3Vectors.ts` — durable stores.
- `agentcore.ts`, `bedrockAgentMemory.ts`, `memoryBank.ts` — hosted memory
  services behind the same port.
