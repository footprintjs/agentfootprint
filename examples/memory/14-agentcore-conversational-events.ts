/**
 * Choose conversational events per entry with a scripted public SDK module.
 *
 * No AWS/model calls or credentials. The fixture stores event blobs only; it
 * does not run extraction. On the service, deleting/forgetting source events
 * or hiding entries by local TTL does not erase derived records. SKIP applies
 * only to the current event, not earlier extraction or retention.
 *
 * Invocation counts below stop at sdk.send; an actual SDK or custom transport
 * may make wire retries under its existing policy.
 */
import assert from 'node:assert/strict';
import {
  AgentCoreStore,
  type AgentCoreEventPayloadChoice,
  type AgentCoreEventPayloadSelector,
  type BedrockAgentCoreSdkModule,
  type MemoryEntry,
} from '../../src/doors/memory.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/14-agentcore-conversational-events',
  title: 'AgentCore — choose conversational events per entry',
  group: 'memory',
  description:
    'A scripted SDK checks conversational and blob event bodies, extraction skip and entry round-trips. No AWS calls.',
  defaultInput: '',
  providerSlots: [],
  tags: ['memory', 'adapter', 'aws', 'agentcore', 'offline'],
};

type ExampleValue =
  | { kind: 'message'; role: 'user' | 'assistant' | 'tool' | 'other'; content: string }
  | { kind: 'note'; content: string };

export async function run(): Promise<string> {
  const created: CreatedEvent[] = [];
  const sdk = scriptedSdk(created);

  // #region choose-events
  const eventPayload: AgentCoreEventPayloadSelector = (entry): AgentCoreEventPayloadChoice => {
    const value = entry.value;
    if (value === null || typeof value !== 'object') {
      throw new TypeError('This example expects a message or note.');
    }
    const data = value as Record<string, unknown>;
    if (data['kind'] === 'note') return { kind: 'blob' };
    const role = data['role'];
    if (
      data['kind'] !== 'message' ||
      typeof data['content'] !== 'string' ||
      (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'other')
    ) {
      throw new TypeError('This example requires an explicit text message and role.');
    }
    return { kind: 'conversational', role, text: data['content'] };
  };

  const store = new AgentCoreStore({ memoryId: 'offline-memory', sdk, eventPayload });
  const identity = { conversationId: 'offline-thread' };
  const preference = entry('preference', {
    kind: 'message',
    role: 'user',
    content: 'I prefer email updates.',
  });
  const scratch = entry('scratch', { kind: 'note', content: 'Temporary working note.' });

  await store.putMany(identity, [preference, scratch]);
  // A conversation may still be stored without extracting this event.
  await store.put(
    identity,
    entry('private-turn', {
      kind: 'message',
      role: 'assistant',
      content: 'This turn stays out of extraction.',
    }),
    { extraction: 'skip' },
  );
  // #endregion choose-events

  assert.deepEqual(
    created.map((request) => request.payload.length),
    [2, 1, 2],
  );
  const conversational = created[0]?.payload.find((part) => 'conversational' in part);
  assert.ok(conversational && 'conversational' in conversational);
  assert.deepEqual(conversational.conversational, {
    role: 'USER',
    content: { text: preference.value.content },
  });
  assert.equal(created[2]?.extractionMode, 'SKIP');
  const restored = await store.get<ExampleValue>(identity, preference.id);
  assert.deepEqual(restored?.value, preference.value);
  await store.close();

  return 'Three scripted SDK write invocations; payload items 2/1/2; SKIP forwarded; entry round-trip preserved. No AWS calls or extraction proof.';
}

function entry(id: string, value: ExampleValue): MemoryEntry<ExampleValue> {
  return {
    id,
    value,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    lastAccessedAt: 1,
    accessCount: 0,
  };
}

type PayloadItem =
  | { blob: string }
  | { conversational: { role: string; content: { text: string } } };

interface CreatedEvent {
  payload: PayloadItem[];
  extractionMode?: 'SKIP';
}

function scriptedSdk(created: CreatedEvent[]): BedrockAgentCoreSdkModule {
  class CreateEventCommand {
    constructor(readonly input: CreatedEvent) {}
  }
  class ListEventsCommand {
    constructor(readonly input: unknown) {}
  }
  return {
    // Static modeled members, as the SDK exposes them; no lazy schema function runs.
    CreateEventInput$: [
      3,
      'com.amazonaws.bedrockagentcore',
      'CreateEventInput',
      0,
      [
        'memoryId',
        'actorId',
        'sessionId',
        'eventTimestamp',
        'payload',
        'extractionMode',
        'extractionConfig',
      ],
    ],
    PayloadType$: [
      4,
      'com.amazonaws.bedrockagentcore',
      'PayloadType',
      0,
      ['conversational', 'blob', 'json'],
    ],
    Conversational$: [
      3,
      'com.amazonaws.bedrockagentcore',
      'Conversational',
      0,
      ['content', 'role'],
    ],
    Content$: [4, 'com.amazonaws.bedrockagentcore', 'Content', 0, ['text']],
    CreateEventCommand,
    ListEventsCommand,
    BedrockAgentCoreClient: class {
      async send(command: unknown): Promise<unknown> {
        if (command instanceof CreateEventCommand) {
          created.push(command.input);
          return {};
        }
        if (command instanceof ListEventsCommand) {
          return {
            events: created.map((request, index) => ({
              eventId: `event-${index + 1}`,
              payload: request.payload,
            })),
          };
        }
        throw new Error('Unexpected command in the offline SDK.');
      }
    },
  };
}

if (isCliEntry(import.meta.url)) run().then(printResult).catch(console.error);
