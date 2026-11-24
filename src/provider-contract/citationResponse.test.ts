import { describe, expect, it } from 'vitest';
import { carryCitationResponse, createCitationResponseOwner } from './citationResponse.js';
import type { LLMResponse } from './types.js';

const draft: LLMResponse = { content: 'Draft', toolCalls: [], usage: { input: 0, output: 0 } };
const offer = { offer: 'draft-offer', results: [] };

describe('submitted citation response ownership', () => {
  it('reads only the response object selected by the caller and only in its owning call', () => {
    const first = createCitationResponseOwner();
    const second = createCitationResponseOwner();
    first.record(draft, offer);
    expect(first.read(draft)).toBe(offer);
    expect(first.read({ ...draft })).toBeUndefined();
    expect(second.read(draft)).toBeUndefined();
  });

  it('carries proof through an owned metadata copy, but refuses changed answer text', () => {
    const owner = createCitationResponseOwner();
    const original = { ...draft };
    owner.record(original, offer);
    const copied = carryCitationResponse(original, { ...original, usage: { input: 1, output: 1 } });
    expect(owner.read(copied)).toBe(offer);
    const rewritten = carryCitationResponse(original, { ...original, content: 'Different' });
    expect(owner.read(rewritten)).toBeUndefined();
    original.content = 'Also different';
    expect(owner.read(original)).toBeUndefined();
  });
});
