import { describe, expect, it } from 'vitest';
import type { LLMMessage } from '../../provider-contract/types.js';
import { stripFrameworkFields } from './composeRequest.js';

const occurrence = [1, 2, 3, 4, 5] as const;
const args = Object.freeze({ callOccurrenceKey: 'a tool argument' });
const providerMeta = Object.freeze({ callOccurrenceKey: 'provider data' });
const call = Object.freeze({ id: 'c1', name: 'lookup', args, providerMeta });
const unmarkedCall = Object.freeze({ id: 'c2', name: 'lookup', args: {} });
const result = { role: 'tool', content: 'found', toolCallId: 'c1', toolName: 'lookup' } as const;

describe('stripFrameworkFields keeps call occurrence keys on the record', () => {
  it('removes a key on a tool result before serializing the provider request', () => {
    const assistant: LLMMessage = { role: 'assistant', content: '', toolCalls: [call] };
    const recordedResult = Object.freeze({ ...result, callOccurrenceKey: occurrence });
    const projected = stripFrameworkFields([assistant, recordedResult]);

    expect(JSON.stringify(projected)).toBe(JSON.stringify([assistant, result]));
    expect(projected[0]).toBe(assistant);
    expect(recordedResult.callOccurrenceKey).toBe(occurrence);
  });

  it('removes a key on a proposed call while keeping tool arguments and provider metadata', () => {
    const recordedCall = Object.freeze({ ...call, callOccurrenceKey: occurrence });
    const assistant: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: Object.freeze([recordedCall, unmarkedCall]),
    };
    const [projected] = stripFrameworkFields([assistant, result]);

    expect(JSON.stringify(projected)).toBe(
      JSON.stringify({ ...assistant, toolCalls: [call, unmarkedCall] }),
    );
    expect(projected.toolCalls?.[0]?.args).toBe(args);
    expect(projected.toolCalls?.[0]?.providerMeta).toBe(providerMeta);
    expect(projected.toolCalls?.[1]).toBe(unmarkedCall);
    expect(assistant.toolCalls?.[0]).toBe(recordedCall);
  });

  it('keeps an unmarked array by reference and removes even an explicitly undefined key', () => {
    const assistant: LLMMessage = { role: 'assistant', content: '', toolCalls: [call] };
    const unmarked = [assistant, result];
    expect(stripFrameworkFields(unmarked)).toBe(unmarked);

    const markedResult = { ...result, callOccurrenceKey: undefined };
    const markedAssistant: LLMMessage = {
      ...assistant,
      toolCalls: [{ ...call, callOccurrenceKey: undefined }],
    };
    const [projectedAssistant, projectedResult] = stripFrameworkFields([
      markedAssistant,
      markedResult,
    ]);
    expect(projectedAssistant.toolCalls?.[0]).not.toHaveProperty('callOccurrenceKey');
    expect(projectedResult).not.toHaveProperty('callOccurrenceKey');
  });

  it.each(['timeout', undefined] as const)(
    'keeps a sole failure category off the provider wire (%s)',
    (toolFailureCategory) => {
      const [projected] = stripFrameworkFields([{ ...result, toolFailureCategory }]);
      expect(projected).toEqual(result);
      expect(projected).not.toHaveProperty('toolFailureCategory');
    },
  );

  it('keeps a declaration and its advice off the provider wire', () => {
    const resultWithDeclaration: LLMMessage = {
      ...result,
      toolDeclaredFailure: {
        origin: 'declared',
        declaredCategory: 'timeout',
        tryInstead: 'Private advice.',
      },
    };
    expect(stripFrameworkFields([resultWithDeclaration])).toEqual([result]);
  });

  it('reuses a stable projection and rebuilds it when either side changes', () => {
    const recordedResult = { ...result, content: 'found', callOccurrenceKey: occurrence };
    const history = [recordedResult];
    const [first] = stripFrameworkFields(history, true);
    expect(stripFrameworkFields(history, true)[0]).toBe(first);

    (first as { content: string }).content = 'edited by an adapter';
    const [restored] = stripFrameworkFields(history, true);
    expect(restored).not.toBe(first);
    expect(restored).toEqual(result);

    recordedResult.content = 'new recorded content';
    expect(stripFrameworkFields(history, true)[0]).toEqual({
      ...result,
      content: 'new recorded content',
    });
  });
});
