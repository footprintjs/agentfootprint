import { describe, expect, it } from 'vitest';
import {
  prepareCitationOffer,
  requestAttempt,
} from '../../../../provider-contract/requestObserver.js';
import type { LLMMessage, LLMResponse } from '../../../../provider-contract/types.js';
import { captureFindingsRequest } from '../../findings/admission.js';
import { citationOfferForCall, type CitationSource } from './citationOffer.js';

const first: LLMMessage = { role: 'tool', toolCallId: 'c1', content: 'same body' };
const second: LLMMessage = { ...first };
const resultA: CitationSource = {
  callOccurrenceKey: [1, 2, 3, 4, 0],
  resultId: 'claim-result/a',
  projected: { ...first },
  body: 'same body',
};
const resultB: CitationSource = {
  callOccurrenceKey: [1, 2, 3, 4, 1],
  resultId: 'claim-result/b',
  projected: { ...second },
  body: 'same body',
};

function frame() {
  let number = 0;
  const sources = new Map([
    [first, resultA],
    [second, resultB],
  ]);
  const capture = citationOfferForCall(sources, () => `offer-${++number}`);
  const hooks = capture.attach({});
  return { capture, hooks };
}

function response(content: string): LLMResponse {
  return { content, toolCalls: [], usage: { input: 1, output: 1 } };
}

describe('citations from an accepted request', () => {
  it('proves the surviving second occurrence where the legacy provider-ID scan was ambiguous', () => {
    const request = { model: 'mock', messages: [second] };
    expect(captureFindingsRequest(request, [first, second], 0).results[0]?.reason).toBe(
      'ambiguous',
    );
    const { capture, hooks } = frame();
    const leaf = requestAttempt(hooks, request);
    const offer = prepareCitationOffer(leaf.hooks, [
      { source: second, body: 'same body', blockNumber: 1 },
    ]);
    expect(offer?.instruction).toContain('[c:offer-1:1] refers to submitted tool result block 1.');
    const answer = response('I cite the second body [c:offer-1:1].');
    offer?.accept(answer);
    leaf.close();
    const receipt = capture.accepted(answer);
    expect(receipt?.results).toEqual([
      {
        occurrence: resultB.callOccurrenceKey,
        resultId: resultB.resultId,
        bodyDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        slot: 1,
      },
    ]);
    expect(JSON.stringify(receipt)).not.toContain('same body');
  });

  it('keeps equal bodies distinct across grouped blocks and does not reuse an abandoned offer', () => {
    const { capture, hooks } = frame();
    const request = { model: 'mock', messages: [first, second] };
    const abandoned = requestAttempt(hooks, request);
    const prior = prepareCitationOffer(abandoned.hooks, [
      { source: first, body: 'same body', blockNumber: 1 },
    ]);
    const draft = response('Draft');
    prior?.accept(draft);
    abandoned.close();
    const leaf = requestAttempt(hooks, request);
    const offer = prepareCitationOffer(leaf.hooks, [
      { source: first, body: 'same body', blockNumber: 1 },
      { source: second, body: 'same body', blockNumber: 2 },
    ]);
    const answer = response('Accepted');
    offer?.accept(answer);
    leaf.close();
    expect(capture.accepted(answer)?.offer).toBe('offer-2');
    expect(
      capture.accepted(answer)?.results.map(({ occurrence, slot }) => [occurrence, slot]),
    ).toEqual([
      [resultA.callOccurrenceKey, 1],
      [resultB.callOccurrenceKey, 2],
    ]);
    expect(capture.accepted(response('Accepted'))).toBeUndefined();
  });

  it('refuses improvised custody, edited bytes and duplicated block locations', () => {
    const { hooks } = frame();
    expect(
      prepareCitationOffer(hooks, [{ source: { ...second }, body: 'same body', blockNumber: 1 }]),
    ).toBeUndefined();
    expect(
      prepareCitationOffer(hooks, [{ source: second, body: 'changed body', blockNumber: 1 }]),
    ).toBeUndefined();
    expect(
      prepareCitationOffer(hooks, [
        { source: first, body: 'same body', blockNumber: 1 },
        { source: second, body: 'same body', blockNumber: 1 },
      ]),
    ).toBeUndefined();
  });
});
