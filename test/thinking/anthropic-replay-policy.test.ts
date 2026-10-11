/** Offline Messages bodies: exact active replay vs observable completed-turn omission. */
import { describe, expect, it, vi } from 'vitest';
import type { LLMMessage, LLMRequest } from '../../src/adapters/types.js';
import {
  buildMessagesBody,
  fromAnthropicResponse,
  type AnthropicContentBlock,
} from '../../src/adapters/llm/anthropicMessagesWire.js';
import { toAnthropicMessages } from '../../src/adapters/llm/anthropicMessageProjection.js';
import { omitAnthropicThinking } from '../../src/adapters/llm/anthropicReplayLayout.js';
import {
  prepareAnthropicReplay,
  thinkingReplayBinding,
} from '../../src/adapters/llm/anthropicThinkingReplay.js';
import { anthropicThinkingHandler } from '../../src/thinking/AnthropicThinkingHandler.js';
import { UnsafeThinkingReplayError } from '../../src/thinking/replay.js';
import { retireReplayHistory } from '../../src/thinking/replayHistory.js';
import { replayPreparedHook } from '../../src/recorders/core/replayHooks.js';
import { RECEIPT_KEY } from '../../src/lib/time-travel/receipt.js';
import { adoptScopeOutsideRun, outsideRunFor } from '../../src/redaction/runRedaction.js';
import {
  buildCheckpoint,
  retainReplayRetirements,
  type RunCheckpointTracker,
} from '../../src/core/runCheckpoint.js';

const MODEL = 'claude-sonnet-5-5';
const tool = {
  name: 'lookup',
  description: 'Look up.',
  inputSchema: { type: 'object', properties: { key: { type: 'string' } } },
};
const root: LLMRequest = {
  model: MODEL,
  systemPrompt: 'stable rules',
  tools: [tool],
  messages: [{ role: 'user', content: 'question' }],
};
const signed: AnthropicContentBlock[] = [
  { type: 'text', text: 'before ' },
  { type: 'thinking', thinking: '', signature: 'private-signed-1' },
  { type: 'tool_use', id: 'call1', name: 'lookup', input: { key: 'value' } },
  { type: 'redacted_thinking', data: 'private-redacted-2' },
  { type: 'text', text: ' after' },
];

function assistant(
  request: LLMRequest,
  content = signed,
  stop = 'tool_use',
  id = 'msg1',
): LLMMessage {
  const body = buildMessagesBody(request, {
    model: request.model,
    provider: 'anthropic',
    thinkingMode: () => 'adaptive',
  });
  const response = fromAnthropicResponse(
    {
      id,
      model: request.model,
      role: 'assistant',
      content,
      stop_reason: stop,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    thinkingReplayBinding(body, request.model)(id),
  );
  return {
    role: 'assistant',
    content: response.content,
    ...(response.toolCalls !== undefined && { toolCalls: response.toolCalls }),
    thinkingBlocks: anthropicThinkingHandler.normalize(response.rawThinking),
    replay: response.replay,
  };
}
function active(model = MODEL): LLMRequest {
  const initial = { ...root, model };
  return {
    ...initial,
    messages: [
      ...initial.messages,
      assistant(initial),
      { role: 'tool', content: 'result', toolCallId: 'call1' },
    ],
  };
}
function completed(model = MODEL): LLMRequest {
  const request = active(model);
  return {
    ...request,
    messages: [
      ...request.messages,
      assistant(request, [{ type: 'text', text: 'done' }], 'end_turn', 'msg2'),
      { role: 'user', content: 'next question' },
    ],
  };
}
const plan = (request: LLMRequest) => prepareAnthropicReplay(request, request.model, 'anthropic');

describe('Anthropic active-turn replay policy', () => {
  it('stable saved body preserves every block including empty signed thinking and interleaving', () => {
    const request = JSON.parse(JSON.stringify(active())) as LLMRequest;
    const prepared = plan(request);
    expect(prepared.request).toBe(request);
    expect(prepared.omissions).toEqual([]);
    expect(toAnthropicMessages(prepared.request.messages)[1].content).toEqual(signed);
  });
  it.each([
    ['system', (r: LLMRequest) => ({ ...r, systemPrompt: 'changed' })],
    [
      'tool definition',
      (r: LLMRequest) => ({ ...r, tools: [{ ...tool, description: 'changed' }] }),
    ],
    [
      'earlier question',
      (r: LLMRequest) => ({
        ...r,
        messages: [{ role: 'user' as const, content: 'changed' }, ...r.messages.slice(1)],
      }),
    ],
  ])('%s edits refuse before sending and explain recovery', (_, edit) => {
    const request = edit(active());
    expect(() => plan(request)).toThrow(UnsafeThinkingReplayError);
    expect(() => plan(request)).toThrow(/Keep the system prompt/);
    try {
      plan(request);
    } catch (error) {
      expect(error).toMatchObject({ reason: 'prefix-changed', retryable: false });
    }
  });
  it.each(['content', 'signature', 'all-blocks', 'one-block', 'tool-args'] as const)(
    '%s edits cannot silently reconstruct an active assistant message',
    (edit) => {
      const request = active();
      const original = request.messages[1];
      const message =
        edit === 'content'
          ? { ...original, content: 'rewritten' }
          : edit === 'signature'
          ? {
              ...original,
              thinkingBlocks: original.thinkingBlocks!.map((b) => ({ ...b, signature: 'changed' })),
            }
          : edit === 'all-blocks'
          ? { ...original, thinkingBlocks: [] }
          : edit === 'one-block'
          ? { ...original, thinkingBlocks: original.thinkingBlocks!.slice(1) }
          : {
              ...original,
              toolCalls: original.toolCalls!.map((c) => ({ ...c, args: { key: 'changed' } })),
            };
      expect(() =>
        plan({
          ...request,
          messages: [request.messages[0], message, ...request.messages.slice(2)],
        }),
      ).toThrow(UnsafeThinkingReplayError);
    },
  );
  it('tool results and user nudges do not certify completion', () => {
    const request = active();
    expect(() =>
      plan({
        ...request,
        systemPrompt: 'changed',
        messages: [...request.messages, { role: 'user', content: 'please finish' }],
      }),
    ).toThrow(UnsafeThinkingReplayError);
  });
  it('max_tokens is not a completed tool turn', () => {
    const request = active();
    const terminal = assistant(request, [{ type: 'text', text: 'cut off' }], 'max_tokens', 'msg2');
    expect(() =>
      plan({ ...request, systemPrompt: 'changed', messages: [...request.messages, terminal] }),
    ).toThrow(UnsafeThinkingReplayError);
  });
  it('an end_turn with unresolved parallel tools is not completion', () => {
    const request = active();
    const missingResult = { ...request, messages: request.messages.slice(0, 2) };
    const terminal = assistant(missingResult, [{ type: 'text', text: 'done' }], 'end_turn', 'msg2');
    expect(() =>
      plan({
        ...missingResult,
        systemPrompt: 'changed',
        messages: [...missingResult.messages, terminal],
      }),
    ).toThrow(UnsafeThinkingReplayError);
  });
  it.each(['claude-sonnet-4-5-20250929', 'claude-mythos-5-1', 'opaque-alias'])(
    'does not invent prefix binding for %s',
    (model) => {
      const request = { ...active(model), systemPrompt: 'changed' };
      expect(plan(request).request).toBe(request);
    },
  );
  it('changing models alone is server-owned, not a reason to omit', () => {
    const request = { ...active(), model: 'claude-opus-5-5', systemPrompt: 'changed' };
    expect(plan(request).request).toBe(request);
  });
  it('missing local provenance is unknown, not proof of an invalid signature', () => {
    const request = active();
    const { replay: _replay, ...old } = request.messages[1];
    const legacy = {
      ...request,
      systemPrompt: 'changed',
      messages: [request.messages[0], old, ...request.messages.slice(2)],
    };
    expect(plan(legacy).request).toBe(legacy);
  });
  it('a missing signature is locally invalid even without replay metadata', () => {
    const request: LLMRequest = {
      ...root,
      messages: [
        ...root.messages,
        {
          role: 'assistant',
          content: '',
          thinkingBlocks: [{ type: 'thinking', content: 'unsigned' }],
        },
      ],
    };
    expect(() => plan(request)).toThrow(/missing-signature/);
  });
  it('sampling settings do not invalidate a prefix', () => {
    const request = { ...active(), maxTokens: 999, temperature: 0.5 };
    expect(plan(request).request).toBe(request);
  });
});

describe('permitted completed-turn omissions', () => {
  function missingMiddleSignature(knownCurrent: boolean): LLMRequest {
    const first = completed();
    const middle = assistant(
      first,
      [
        { type: 'thinking', thinking: 'middle', signature: 'middle-sig' },
        { type: 'text', text: 'second answer' },
      ],
      'end_turn',
      'middle',
    );
    const beforeCurrent = {
      ...first,
      messages: [...first.messages, middle, { role: 'user' as const, content: 'third question' }],
    };
    const current = assistant(beforeCurrent, signed, 'tool_use', 'current');
    const { replay: _proof, ...legacyCurrent } = current;
    const messages = [...beforeCurrent.messages, knownCurrent ? current : legacyCurrent];
    messages[first.messages.length] = {
      ...middle,
      thinkingBlocks: [{ type: 'thinking', content: 'middle' }],
    };
    return { ...beforeCurrent, messages };
  }
  it('removes an earlier completed prefix, never creates a gap before unknown active thinking', () => {
    const request = missingMiddleSignature(false);
    const result = plan(request);
    expect(result.omissions.map((o) => [o.messageIndex, o.reason])).toEqual([
      [1, 'sequence-changed'],
      [1, 'sequence-changed'],
      [5, 'missing-signature'],
    ]);
    expect(result.request.messages.at(-1)).toBe(request.messages.at(-1));
    expect(toAnthropicMessages(result.request.messages).at(-1)).toEqual(
      toAnthropicMessages(request.messages).at(-1),
    );
    expect(plan(result.request).omissions).toEqual([]);
  });
  it('prefix repair does not excuse a proven changed non-thinking prefix on the active turn', () => {
    const request = { ...missingMiddleSignature(true), systemPrompt: 'changed' };
    const original = JSON.stringify(request);
    expect(() => plan(request)).toThrow(/prefix-changed/);
    expect(JSON.stringify(request)).toBe(original);
  });
  it('cannot reintroduce older thinking after newer reasoning was produced without it', () => {
    const request = completed();
    const messages = [...request.messages];
    messages[1] = omitAnthropicThinking(messages[1]);
    const withoutOld = { ...request, messages };
    const newer = assistant(withoutOld, signed, 'tool_use', 'msg3');
    expect(() => plan({ ...request, messages: [...request.messages, newer] })).toThrow(
      /sequence-changed/,
    );
  });
  it('allows dropping a completed prefix of thinking before an active continuation', () => {
    const request = completed();
    const newer = assistant(request, signed, 'tool_use', 'msg3');
    const messages = [...request.messages, newer];
    messages[1] = omitAnthropicThinking(messages[1]);
    const trimmed = { ...request, messages };
    expect(plan(trimmed).request).toBe(trimmed);
  });
  it('refuses a gap between older and current thinking instead of dropping active thinking', () => {
    const first = completed();
    const middle = assistant(
      first,
      [
        { type: 'thinking', thinking: 'middle', signature: 'middle-sig' },
        { type: 'text', text: 'second answer' },
      ],
      'end_turn',
      'middle',
    );
    const withMiddle = {
      ...first,
      messages: [...first.messages, middle, { role: 'user' as const, content: 'third question' }],
    };
    const current = assistant(withMiddle, signed, 'tool_use', 'current');
    const messages = [...withMiddle.messages, current];
    messages[first.messages.length] = { ...middle, thinkingBlocks: [] };
    expect(() => plan({ ...withMiddle, messages })).toThrow(/sequence-changed/);
  });
  it('drops each unsafe earlier block with a report, leaving text and tools in exact order', () => {
    const request = { ...completed(), systemPrompt: 'changed' };
    const before = JSON.stringify(request);
    const prepared = plan(request);
    expect(JSON.stringify(request)).toBe(before);
    expect(prepared.omissions).toEqual([
      expect.objectContaining({ messageIndex: 1, blockIndex: 0, reason: 'prefix-changed' }),
      expect.objectContaining({ messageIndex: 1, blockIndex: 1, reason: 'prefix-changed' }),
    ]);
    expect(toAnthropicMessages(prepared.request.messages)[1].content).toEqual([
      signed[0],
      signed[2],
      signed[4],
    ]);
    expect(JSON.stringify(prepared.omissions)).not.toMatch(/private-|question|stable rules/);
    expect(plan(prepared.request).omissions).toEqual([]);
    expect(plan(JSON.parse(JSON.stringify(prepared.request))).omissions).toEqual([]);
  });
  it('does not omit safe earlier thinking just because it is old', () => {
    const request = completed();
    expect(plan(request).request).toBe(request);
  });
  it('does not claim or rewrite a completed omission the caller already made', () => {
    const request = completed();
    const messages = [...request.messages];
    messages[1] = { ...messages[1], thinkingBlocks: [] };
    const supplied = { ...request, messages };
    expect(plan(supplied).request).toBe(supplied);
    expect(plan(supplied).omissions).toEqual([]);
  });
  it('allows edited text on completed turns without resurrecting the original', () => {
    const request = completed();
    const messages = [...request.messages];
    messages[1] = { ...messages[1], content: 'edited answer' };
    const prepared = plan({ ...request, messages });
    expect(prepared.omissions).toHaveLength(2);
    expect(prepared.request.messages[1].content).toBe('edited answer');
    expect(prepared.request.messages[1].thinkingBlocks).toBeUndefined();
  });
  it('refuses a later active turn even when an earlier turn finished', () => {
    const request = completed();
    const current = assistant(request, signed, 'tool_use', 'msg3');
    expect(() =>
      plan({
        ...request,
        messages: [
          ...request.messages,
          current,
          { role: 'tool', content: 'result', toolCallId: 'call1' },
        ],
        systemPrompt: 'changed',
      }),
    ).toThrow(UnsafeThinkingReplayError);
  });
  it('retirement matches history by identity, preserves host fields and survives a restart', () => {
    const request = { ...completed(), systemPrompt: 'changed' };
    const history = request.messages.map((m) => ({ ...m, hostNote: 'keep me' }));
    const retired = retireReplayHistory(history, plan(request));
    expect(retired[1]).toMatchObject({ hostNote: 'keep me', replay: { thinkingRetired: true } });
    expect(retired[1].thinkingBlocks).toBeUndefined();
    expect(plan({ ...request, messages: JSON.parse(JSON.stringify(retired)) }).omissions).toEqual(
      [],
    );
    expect(retireReplayHistory(retired, plan(request))).toBe(retired);
  });
  it('identical content on a different stamped response is not retired', () => {
    const request = { ...completed(), systemPrompt: 'changed' };
    const other = {
      ...request.messages[1],
      replay: { ...request.messages[1].replay!, id: 'different-response' },
    };
    const history = [other, ...request.messages];
    const retired = retireReplayHistory(history, plan(request));
    expect(retired[0]).toBe(other);
    expect(retired[2].thinkingBlocks).toBeUndefined();
  });
  it('checkpoint retention keeps only approved thinking edits, not a failed request history', () => {
    const request = { ...completed(), systemPrompt: 'changed' };
    const other = {
      ...request.messages[1],
      replay: { ...request.messages[1].replay!, id: 'other' },
    };
    const tracker: RunCheckpointTracker = {
      runId: 'run',
      originalInput: { message: 'original' },
      history: [other, ...request.messages.slice(0, 2)],
      lastCompletedIteration: 4,
    };
    const prepared = plan(request);
    retainReplayRetirements(tracker, prepared);
    const saved = buildCheckpoint(tracker);
    expect(saved.history).toHaveLength(3);
    expect(saved.history[0]).toBe(other);
    expect(saved.history[2].thinkingBlocks).toBeUndefined();
    expect(saved.history[2].content).toBe(request.messages[1].content);
    expect(saved.history[2].toolCalls).toBe(request.messages[1].toolCalls);
    expect(saved.lastCompletedIteration).toBe(4);
    expect(saved.originalInput).toEqual({ message: 'original' });
    expect(JSON.stringify(tracker.replayRetirements)).not.toMatch(
      /private-|stable rules|next question/,
    );
  });
});

describe('runtime omission visibility', () => {
  function scope() {
    const request = { ...completed(), systemPrompt: 'changed' };
    const state: Record<string, unknown> = {
      history: request.messages,
      [RECEIPT_KEY]: { requestId: 'receipt' },
    };
    const events: unknown[] = [];
    const scope = {
      $getValue: (key: string) => state[key],
      $setValue: (key: string, value: unknown) => {
        state[key] = value;
      },
      $emit: (type: string, payload: unknown) => {
        events.push({ type, payload });
      },
    };
    adoptScopeOutsideRun(scope, outsideRunFor({ state: 'declared-none' }));
    return { request, state, events, scope };
  }
  it('records each block before transport and annotates only a newly minted receipt', () => {
    const s = scope();
    replayPreparedHook(s.scope, true)(plan(s.request));
    expect(s.events).toEqual(
      [0, 1].map((blockIndex) => ({
        type: 'agentfootprint.agent.thinking_omitted',
        payload: {
          providerName: 'anthropic',
          model: MODEL,
          messageIndex: 1,
          blockIndex,
          reason: 'prefix-changed',
          phase: 'prepared',
        },
      })),
    );
    expect(s.state[RECEIPT_KEY]).toMatchObject({
      replayPreparations: [{ boundary: 'provider-adapter', phase: 'prepared', omittedBlocks: 2 }],
    });
    expect(JSON.stringify(s.events)).not.toMatch(/private-|msg1|signature|question|fingerprint/);
    expect((s.state.history as LLMMessage[])[1].thinkingBlocks).toBeUndefined();
  });
  it('does not annotate an inherited receipt when this call disables receipts', () => {
    const s = scope();
    const receipt = s.state[RECEIPT_KEY];
    replayPreparedHook(s.scope, false)(plan(s.request));
    expect(s.state[RECEIPT_KEY]).toBe(receipt);
    expect(s.events).toHaveLength(2);
  });
  it('a broken event listener cannot undo durable retirement', () => {
    const s = scope();
    replayPreparedHook(
      {
        ...s.scope,
        $emit: () => {
          throw new Error('sink failed');
        },
      },
      true,
    )(plan(s.request));
    expect((s.state.history as LLMMessage[])[1].thinkingBlocks).toBeUndefined();
  });
  it('does not swallow a failure to persist protocol state', () => {
    const s = scope();
    const persisted = vi.fn();
    expect(() =>
      replayPreparedHook(
        {
          ...s.scope,
          $setValue: () => {
            throw new Error('storage failed');
          },
        },
        true,
        persisted,
      )(plan(s.request)),
    ).toThrow('storage failed');
    expect(s.events).toEqual([]);
    expect(persisted).not.toHaveBeenCalled();
  });
  it('updates the checkpoint owner after state persistence and before observation', () => {
    const s = scope();
    const persisted = vi.fn(() => {
      expect((s.state.history as LLMMessage[])[1].thinkingBlocks).toBeUndefined();
      expect(s.events).toEqual([]);
    });
    replayPreparedHook(s.scope, true, persisted)(plan(s.request));
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(s.events).toHaveLength(2);
  });
  it('a failed receipt annotation does not lose an already-persisted retirement', () => {
    const s = scope();
    const persisted = vi.fn();
    expect(() =>
      replayPreparedHook(
        {
          ...s.scope,
          $setValue(key: string, value: unknown) {
            if (key === RECEIPT_KEY) throw new Error('receipt failed');
            s.scope.$setValue(key, value);
          },
        },
        true,
        persisted,
      )(plan(s.request)),
    ).toThrow('receipt failed');
    expect((s.state.history as LLMMessage[])[1].thinkingBlocks).toBeUndefined();
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(s.events).toEqual([]);
  });
});
