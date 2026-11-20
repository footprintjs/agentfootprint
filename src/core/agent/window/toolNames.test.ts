import { expect, it } from 'vitest';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { droppedToolNames } from './toolNames.js';

it('recovers a missing tool name only from an older keyless pair', () => {
  const old: LLMMessage = { role: 'tool', content: 'rows', toolCallId: 'shared' };
  const first = {
    id: 'shared',
    name: 'first_lookup',
    args: {},
    callOccurrenceKey: [1, 2, 3, 4, 0] as const,
  };
  const modern: LLMMessage = { ...old, callOccurrenceKey: [1, 2, 3, 4, 1] };
  const oldProposal: LLMMessage = {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'shared', name: 'old_lookup', args: {} }],
  };
  const modernProposal: LLMMessage = { role: 'assistant', content: '', toolCalls: [first] };
  expect(droppedToolNames([modern], [modernProposal, oldProposal])).toEqual([]);
  expect(droppedToolNames([old], [modernProposal, oldProposal])).toEqual(['old_lookup']);
});
