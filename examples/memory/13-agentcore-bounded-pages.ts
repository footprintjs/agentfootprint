/** AgentCore pages may be smaller than a MemoryStore request; follow their cursors. */
import {
  AgentCoreStore,
  type BedrockAgentCoreSdkModule,
  type MemoryEntry,
} from '../../src/doors/memory.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/13-agentcore-bounded-pages',
  title: 'AgentCore — public SDK injection and bounded pages',
  group: 'memory',
  description: 'A scripted SDK serves 251 stored entries in three capped pages. No AWS calls.',
  defaultInput: '',
  providerSlots: [],
  tags: ['memory', 'adapter', 'aws', 'agentcore', 'pagination', 'offline'],
};

export async function run(): Promise<string> {
  // A bundled host can instead import * as sdk from '@aws-sdk/client-bedrock-agentcore'.
  const sdk = scriptedSdk();
  // #region sdk-and-pages
  const store = new AgentCoreStore({ memoryId: 'offline-memory', pageSize: 100, sdk });
  const identity = { conversationId: 'offline-thread' };
  let cursor: string | undefined;
  let count = 0;
  let pages = 0;
  do {
    // A legal port request; AgentCore caps each call to its own 100-event limit.
    const page = await store.list(identity, { limit: 1000, ...(cursor && { cursor }) });
    count += page.entries.length;
    pages++;
    cursor = page.cursor;
  } while (cursor !== undefined);
  await store.close();
  // #endregion sdk-and-pages
  if (count !== 251 || pages !== 3) throw new Error('The capped scan lost a page.');
  return `${count} stored entries read across ${pages} pages; no AWS calls.`;
}

function scriptedSdk(): BedrockAgentCoreSdkModule {
  class ListEventsCommand {
    constructor(readonly input: { maxResults?: number; nextToken?: string }) {}
  }
  return {
    ListEventsCommand,
    BedrockAgentCoreClient: class {
      async send(command: unknown) {
        if (!(command instanceof ListEventsCommand)) throw new Error('Unexpected command.');
        const { maxResults = 20, nextToken } = command.input;
        if (maxResults > 100) throw new Error('AgentCore refuses more than 100 events per page.');
        const start = Number(nextToken ?? 0);
        const end = Math.min(251, start + maxResults);
        const events = Array.from({ length: end - start }, (_, offset) => {
          const turn = start + offset + 1;
          const entry: MemoryEntry = {
            id: `msg-${turn}-0`,
            value: { content: `Turn ${turn}` },
            version: 1,
            createdAt: 1,
            updatedAt: 1,
            lastAccessedAt: 1,
            accessCount: 0,
            source: { turn },
          };
          return { eventId: `event-${turn}`, payload: [{ blob: JSON.stringify(entry) }] };
        });
        return { events, ...(end < 251 && { nextToken: String(end) }) };
      }
    },
  };
}

if (isCliEntry(import.meta.url)) run().then(printResult).catch(console.error);
