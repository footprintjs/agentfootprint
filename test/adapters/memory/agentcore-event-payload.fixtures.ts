/** Offline event/record populations; no extractor or transport attempts are simulated. */
import { vi } from 'vitest';
import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import type {
  AgentCoreLikeClient,
  BedrockAgentCoreSdkModule,
} from '../../../src/adapters/memory/agentcore.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';

export type Choice =
  | { kind: 'blob' }
  | { kind: 'conversational'; role: 'user' | 'assistant' | 'tool' | 'other'; text: string };
export type Selector = (entry: MemoryEntry) => Choice;
export const identity = { tenant: 'acme', principal: 'alice', conversationId: 'thread' };
export const neighbour = { ...identity, principal: 'bob' };
export const scope = { memoryId: 'memory', actorId: 'afp-acme_alice', sessionId: 'afp-thread' };

export function entry(id = 'message', extra: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    value: { role: 'assistant', content: [{ type: 'text', text: 'rich original' }] },
    version: 2,
    createdAt: 10,
    updatedAt: 20,
    lastAccessedAt: 30,
    accessCount: 4,
    metadata: { nested: { label: 'original' } },
    tier: 'warm',
    source: { turn: 3, messageId: 'source-message', runtimeStageId: 'write#1', identity },
    embedding: [0.1, 0.2],
    embeddingModel: 'fixture',
    decayPolicy: { halfLifeMs: 1000, accessBoost: 2 },
    ...extra,
  };
}

type CreateInput = Parameters<AgentCoreLikeClient['createEvent']>[0] & {
  eventPayload?: Choice;
};

export function clientFixture(forwards = true, effect?: (input: CreateInput) => void) {
  const events: { eventId: string; entry: MemoryEntry }[] = [];
  const order: string[] = [];
  const createEvent = vi.fn(async (input: CreateInput) => {
    order.push(`create:${input.entry.id}`);
    effect?.(input);
    events.push({ eventId: `event-${events.length}`, entry: structuredClone(input.entry) });
  });
  const listEvents = vi.fn<AgentCoreLikeClient['listEvents']>(async () => {
    order.push('read');
    return { events };
  });
  const client = {
    ...(forwards && { forwardsEventPayload: true as const }),
    forwardsWriteOptions: true as const,
    createEvent,
    listEvents,
    deleteEvent: vi.fn(async () => undefined),
  };
  return { client, events, order, createEvent, listEvents };
}

type WireInput = Record<string, unknown>;
type SourceEvent = { eventId: string; actorId: string; sessionId: string; payload: unknown };

export function sdkFixture() {
  class Command {
    constructor(readonly input: WireInput) {}
  }
  class CreateEventCommand extends Command {}
  class ListEventsCommand extends Command {}
  class DeleteEventCommand extends Command {}
  class RetrieveMemoryRecordsCommand extends Command {}
  const sent: { name: string; input: WireInput }[] = [];
  const sources: SourceEvent[] = [];
  // Seeded independently: a successful CreateEvent never creates this record.
  const derived = [
    {
      memoryRecordId: 'derived-record',
      content: { text: 'independently seeded derived content' },
      score: 0.9,
      namespaces: ['/actors/afp-acme_alice/sessions/afp-thread'],
    },
  ];
  let onSend: ((input: WireInput) => void) | undefined;
  const send = vi.fn(async (command: Command) => {
    const input = structuredClone(command.input);
    const name = command.constructor.name;
    sent.push({ name, input });
    if (command instanceof CreateEventCommand) {
      sources.push({
        eventId: `event-${sources.length}`,
        actorId: String(input.actorId),
        sessionId: String(input.sessionId),
        payload: input.payload,
      });
      onSend?.(command.input);
      return {};
    }
    if (command instanceof ListEventsCommand) {
      return {
        events: sources.filter(
          (event) => event.actorId === input.actorId && event.sessionId === input.sessionId,
        ),
      };
    }
    if (command instanceof DeleteEventCommand) {
      const at = sources.findIndex(
        (event) =>
          event.eventId === input.eventId &&
          event.actorId === input.actorId &&
          event.sessionId === input.sessionId,
      );
      if (at !== -1) sources.splice(at, 1);
      return {};
    }
    if (command instanceof RetrieveMemoryRecordsCommand) {
      return { memoryRecordSummaries: structuredClone(derived) };
    }
    throw new Error('Unexpected offline SDK command');
  });
  // Static members of the official v3.1114.0 schemas_0.ts; no SDK is loaded.
  const sdk = {
    BedrockAgentCoreClient: class {
      send = send;
    },
    CreateEventCommand,
    ListEventsCommand,
    DeleteEventCommand,
    RetrieveMemoryRecordsCommand,
    CreateEventInput$: [
      3,
      'com.amazonaws.bedrockagentcore',
      'CreateEventInput',
      0,
      [
        'memoryId',
        'actorId',
        'eventTimestamp',
        'payload',
        'sessionId',
        'branch',
        'clientToken',
        'metadata',
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
  };
  const creates = () => sent.filter(({ name }) => name === 'CreateEventCommand');
  const deletes = () => sent.filter(({ name }) => name === 'DeleteEventCommand');
  const seed = (payload: unknown, actorId = scope.actorId) => {
    sources.push({
      eventId: `seed-${sources.length}`,
      actorId,
      sessionId: scope.sessionId,
      payload,
    });
  };
  return {
    sdk,
    sent,
    send,
    sources,
    derived,
    creates,
    deletes,
    seed,
    onSend: (effect: (input: WireInput) => void) => {
      onSend = effect;
    },
  };
}

export function sdkStore(fixture: ReturnType<typeof sdkFixture>, eventPayload?: Selector) {
  // A wider variable keeps the approved new option runnable on the unmodified base.
  const options = {
    memoryId: 'memory',
    sdk: fixture.sdk as unknown as BedrockAgentCoreSdkModule,
    ...(eventPayload !== undefined && { eventPayload }),
  };
  return new AgentCoreStore(options);
}

export function clientStore(client: AgentCoreLikeClient, eventPayload?: Selector) {
  const options = { memoryId: 'memory', _client: client, ...(eventPayload && { eventPayload }) };
  return new AgentCoreStore(options);
}

export function body(value: MemoryEntry, choice?: Choice) {
  return {
    ...scope,
    eventTimestamp: new Date('2026-11-23T00:00:00.000Z'),
    payload: [
      { blob: JSON.stringify(value) },
      ...(choice?.kind === 'conversational'
        ? [{ conversational: { content: { text: choice.text }, role: choice.role.toUpperCase() } }]
        : []),
    ],
  };
}
