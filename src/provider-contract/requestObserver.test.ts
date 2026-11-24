import { describe, expect, it, vi } from 'vitest';
import {
  observeCitationOffers,
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
