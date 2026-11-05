import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const provider = mock({ reply: 'noted' });

// #region code
import { InMemoryStore, MEMORY_STRATEGIES, MEMORY_TYPES, defineMemory, type MemoryStore } from 'agentfootprint/memory';

const scrub = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'));

// Everything the store keeps goes through your filter first. RedisStore works the same way.
class ScrubbingStore extends InMemoryStore {
  override put: MemoryStore['put'] = (identity, entry, ...rest) => super.put(identity, scrub(entry), ...rest);
  override putMany: MemoryStore['putMany'] = (identity, entries, ...rest) => super.putMany(identity, scrub(entries), ...rest);
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
