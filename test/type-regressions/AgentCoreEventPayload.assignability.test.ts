/** Closed public axes: a new role or kind requires a new case before test:types passes. */
import { expect, it } from 'vitest';
import type {
  AgentCoreEventPayloadChoice,
  AgentCoreEventPayloadSelector,
  MemoryWriteOptions,
} from '../../src/doors/memory.js';

type Conversation = Extract<AgentCoreEventPayloadChoice, { kind: 'conversational' }>;
const roles = {
  user: { kind: 'conversational', role: 'user', text: 'user text' },
  assistant: { kind: 'conversational', role: 'assistant', text: 'assistant text' },
  tool: { kind: 'conversational', role: 'tool', text: 'tool text' },
  other: { kind: 'conversational', role: 'other', text: 'other text' },
} satisfies { [R in Conversation['role']]: Conversation & { role: R } };

const kinds = {
  blob: { kind: 'blob' },
  conversational: roles.user,
} satisfies {
  [K in AgentCoreEventPayloadChoice['kind']]: Extract<AgentCoreEventPayloadChoice, { kind: K }>;
};

const synchronous: AgentCoreEventPayloadSelector = () => kinds.conversational;
// @ts-expect-error The adapter-local projection is synchronous, not a Promise contract.
const asynchronous: AgentCoreEventPayloadSelector = async () => kinds.blob;
// @ts-expect-error System is not one of AgentCore's four conversation roles.
const unknownRole: Conversation['role'] = 'system';
// @ts-expect-error Projection belongs to store construction, not the generic write-options port.
const genericOption: MemoryWriteOptions = { eventPayload: synchronous };

it('enumerates both payload kinds and all four roles through the public memory door', () => {
  expect(Object.keys(kinds)).toEqual(['blob', 'conversational']);
  expect(Object.values(roles).map(({ role }) => role)).toEqual([
    'user',
    'assistant',
    'tool',
    'other',
  ]);
  expect([synchronous, asynchronous, unknownRole, genericOption]).toHaveLength(4);
});
