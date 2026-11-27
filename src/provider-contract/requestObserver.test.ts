import { describe, expect, it, vi } from 'vitest';
import {
  observeCacheCommands,
  observeCitationOffers,
  prepareCacheCommand,
  observeRequests,
  prepareCitationOffer,
  requestAttempt,
} from './requestObserver.js';
import type { LLMRequest, LLMResponse } from './types.js';

const request: LLMRequest = { model: 'mock', messages: [] };
const response: LLMResponse = { content: 'answer', toolCalls: [], usage: { input: 1, output: 1 } };

describe('private request offer lifetime', () => {
  it('lets only a live leaf prepare and associate its offer', () => {
    const accept = vi.fn();
    const prepare = vi.fn(() => ({ instruction: 'cite the offered result', accept }));
    const seen = vi.fn();
    const hooks = observeCitationOffers(observeRequests({}, seen), prepare);
    const abandoned = requestAttempt(hooks, request);
    const abandonedOffer = prepareCitationOffer(abandoned.hooks, []);
    expect(abandonedOffer?.instruction).toBe('cite the offered result');
    expect(seen).toHaveBeenCalledWith(request);
    abandoned.close();
    expect(prepareCitationOffer(abandoned.hooks, [])).toBeUndefined();
    abandonedOffer?.accept(response);
    expect(accept).not.toHaveBeenCalled();

    const winner = requestAttempt(hooks, request);
    const acceptedOffer = prepareCitationOffer(winner.hooks, []);
    acceptedOffer?.accept(response);
    acceptedOffer?.accept(response);
    winner.close();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledExactlyOnceWith(response);
  });

  it('keeps an unobserved hook object intact', () => {
    const hooks = { onResilience: vi.fn() };
    expect(requestAttempt(hooks, request).hooks).toBe(hooks);
  });
});

describe('private cache command lifetime', () => {
  it('accepts one response during the attempt and rejects late observations', () => {
    const accepted = vi.fn();
    const observe = vi.fn(() => ({ id: Symbol(), response: accepted }));
    const scope = requestAttempt(observeCacheCommands({}, observe), request);
    const command = { operation: 'Converse', points: 2, reason: 'prepared' } as const;
    const first = prepareCacheCommand(scope.hooks, command);
    const abandoned = prepareCacheCommand(scope.hooks, command);
    expect(first?.id).not.toBe(abandoned?.id);
    first?.response(response);
    first?.response(response);
    scope.close();
    abandoned?.response(response);
    expect(prepareCacheCommand(scope.hooks, command)).toBeUndefined();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(accepted).toHaveBeenCalledExactlyOnceWith(response);
  });
});
