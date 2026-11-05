import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const provider = mock({ reply: 'noted' });

// #region code
import { InMemoryStore, MEMORY_STRATEGIES, MEMORY_TYPES, defineMemory, type MemoryStore } from 'agentfootprint/memory';

const scrub = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'));

// Every way into the store goes through your filter. Extend RedisStore the same way.
class ScrubbingStore extends InMemoryStore {
  override put: MemoryStore['put'] = (identity, entry, options) => super.put(identity, scrub(entry), options);
  override putMany: MemoryStore['putMany'] = (identity, entries, options) =>
    super.putMany(identity, scrub(entries), options);
  override putIfVersion: MemoryStore['putIfVersion'] = (identity, entry, expectedVersion, options) =>
    super.putIfVersion(identity, scrub(entry), expectedVersion, options);
  override recordSignature: MemoryStore['recordSignature'] = (identity, signature) =>
    super.recordSignature(identity, scrub(signature));
  override seen: MemoryStore['seen'] = (identity, signature) => super.seen(identity, scrub(signature));
}

const store = new ScrubbingStore();
const memory = defineMemory({
  id: 'recent',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store,
});
// #endregion code

const agent = Agent.create({ provider, model: 'mock' }).memory(memory).build();
const identity = { conversationId: 'c1' };
await agent.run({ message: 'My SSN is 123-45-6789', identity });
export const kept = JSON.stringify(await store.list(identity));

/* Each write path on its own, because the agent above only exercises the one it needs. */
const direct = { conversationId: 'c2' };
const entry = (id: string) => ({
  id,
  value: { content: `SSN 123-45-6789 in ${id}` },
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  lastAccessedAt: 0,
  accessCount: 0,
});
await store.put(direct, entry('by-put'));
await store.putMany(direct, [entry('by-put-many')]);
export const versioned = await store.putIfVersion(direct, { ...entry('by-put'), version: 2 }, 1);
await store.recordSignature(direct, 'fact: SSN 123-45-6789');
export const keptDirect = JSON.stringify(await store.list(direct));
export const signatureSeen = await store.seen(direct, 'fact: SSN [ssn]');
export const signatureSeenRaw = await store.seen(direct, 'fact: SSN 123-45-6789');
