/** Public module injection is typed; the removed internal spelling cannot return. */
import { expect, it } from 'vitest';
import {
  AgentCoreStore,
  type AgentCoreStoreOptions,
  type BedrockAgentCoreSdkModule,
} from '../../src/doors/memory.js';

const sdk: BedrockAgentCoreSdkModule = {
  BedrockAgentCoreClient: class {
    async send(_command: unknown): Promise<unknown> {
      return { events: [] };
    }
  },
  ListEventsCommand: class {
    constructor(readonly input: { memoryId: string; actorId: string; sessionId: string }) {}
  },
};
const options: AgentCoreStoreOptions = { memoryId: 'fixture', sdk };
const removed: AgentCoreStoreOptions = {
  memoryId: 'fixture',
  // @ts-expect-error The internal spelling was removed; public SDK injection uses sdk.
  _sdk: sdk,
};
void removed;

it('accepts a typed module through the public memory door', async () => {
  await expect(new AgentCoreStore(options).list({ conversationId: 'fixture' })).resolves.toEqual({
    entries: [],
  });
});
