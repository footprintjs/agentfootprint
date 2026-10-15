**Support** — the `MemoryStore` port (CRUD + seen/feedback/forget) and its
reference in-memory implementation.

## What it reads / what it writes
- Reads and writes rows, always scoped by the identity tuple.
- Holds no opinion about attention: what is RECALLED is decided by
  `../retrieval/`, and what is SAID about it by the formatters.

## The one law here
A store declares what it can do rather than letting a caller assume it: what
its own `search()` ranks (`capability.ts`), and which write options it honours
(`writeOptions.ts`). A store that cannot do a thing says so, and the refusal
names the fix — a write option it does not declare is refused by name, never
dropped.

```ts
store.put(identity, entry, { extraction: 'skip' });
// AgentCoreStore: sent as CreateEvent's extractionMode: 'SKIP'
// InMemoryStore:  UnsupportedMemoryWriteOptionError (option: 'extraction')
```

## Files
- `types.ts` — the I/O boundary.
- `InMemoryStore.ts` — the deliberately small reference implementation.
- `staticVectorStore.ts` — serve a corpus built somewhere else, read-only.
- `writeOptions.ts` — the vendor-neutral write options, their one refusal, and
  the binding `defineMemory({ writeOptions })` puts on a memory's writes.
- `capability.ts`, `index.ts`.
