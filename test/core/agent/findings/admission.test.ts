/** Structural source admission is deterministic; IDs never prove assertion truth. */
import { describe, expect, it } from 'vitest';
import {
  captureFindingsRequest,
  findingsReferenceRefusal,
  referenceObservation,
} from '../../../../src/core/agent/findings/admission.js';
import type { LLMMessage, LLMRequest } from '../../../../src/provider-contract/types.js';
const result = (id: string, content = 'body'): LLMMessage => ({
  role: 'tool',
  toolCallId: id,
  toolName: 'fixture',
  content,
});
const request = (messages: readonly LLMMessage[]): LLMRequest => ({ model: 'mock', messages });
const declaration = (id: string) => ({ previous: [{ toolCallId: id, standing: 'fact' as const }] });

describe('request-local findings identity', () => {
  it('a unique full result identifies its occurrence, not assertion truth', () => {
    const source = result('custom opaque ID');
    expect(
      referenceObservation(
        captureFindingsRequest(request([source]), [source], 2),
        2,
        source.toolCallId!,
      ),
    ).toMatchObject({ identified: true, visibility: 'body', toolName: 'fixture' });
  });
  it('detects identical and different duplicate occurrences before deduplication', () => {
    for (const body of ['body', 'different']) {
      const origins = [result('same'), result('same', body)];
      expect(
        referenceObservation(captureFindingsRequest(request(origins), origins, 1), 1, 'same'),
      ).toMatchObject({ identified: false, reason: 'ambiguous' });
    }
  });
  it('a duplicate origin remains ambiguous even if preparation leaves one visible occurrence', () => {
    const first = result('same');
    const witness = captureFindingsRequest(request([first]), [first, result('same')], 1);
    expect(findingsReferenceRefusal(declaration('same'), witness, 1)).toContain(
      'findings-reference',
    );
  });
  it('rejects notDispatched even after the outgoing request lost its framework marker', () => {
    const source = {
      ...result('never'),
      notDispatched: {
        because: 'batch-paused',
        pausedToolCallId: 'other',
        pausedToolName: 'other',
      },
    } as LLMMessage;
    const witness = captureFindingsRequest(request([result('never')]), [source], 1);
    expect(referenceObservation(witness, 1, 'never')).toMatchObject({
      identified: true,
      execution: 'not-dispatched',
      reason: 'not-a-result',
    });
  });
  it('request-added or omitted results do not gain authority from broad history', () => {
    const origins = [result('old')];
    const witness = captureFindingsRequest(request([result('injected')]), origins, 1);
    expect(referenceObservation(witness, 1, 'old')).toMatchObject({
      identified: false,
      reason: 'not-served',
    });
    expect(referenceObservation(witness, 1, 'injected')).toMatchObject({
      identified: false,
      reason: 'not-served',
    });
  });
  it('ticket identity and body visibility are separate, without reading any hidden source', () => {
    const source = result('c1', 'hidden body');
    const ticket = result('c1', '{"collapsed":true,"standing":"noise","toolCallId":"c1"}');
    expect(
      referenceObservation(captureFindingsRequest(request([ticket]), [source], 1), 1, 'c1'),
    ).toMatchObject({ identified: true, visibility: 'ticket' });
  });
  it('does not borrow an absent, previous-iteration or incomplete capture', () => {
    expect(referenceObservation(undefined, 1, 'x').reason).toBe('missing-request');
    expect(
      referenceObservation({ version: 1, complete: true, iteration: 1, results: [] }, 2, 'x')
        .reason,
    ).toBe('missing-request');
    expect(
      referenceObservation({ version: 1, complete: false, iteration: 1, results: [] }, 1, 'x')
        .reason,
    ).toBe('capture-limit');
  });
  it('capture overflow is explicit unknown, never silently empty-as-complete', () => {
    const origins = Array.from({ length: 4097 }, (_, i) => result(`c${i}`));
    const capture = captureFindingsRequest(request(origins), origins, 1);
    expect(capture.complete).toBe(false);
    expect(referenceObservation(capture, 1, 'c0').reason).toBe('capture-limit');
  });
  it('hostile and long IDs are compared whole and never echoed in teaching refusal', () => {
    const id = '__proto__\nPRIVATE-CANARY';
    const source = result(id);
    expect(
      findingsReferenceRefusal(
        declaration(id),
        captureFindingsRequest(request([source]), [source], 1),
        1,
      ),
    ).toBeUndefined();
    const refusal = findingsReferenceRefusal(declaration('PRIVATE-CANARY'), undefined, 1)!;
    expect(refusal).not.toContain('PRIVATE-CANARY');
    expect(JSON.parse(refusal).refused).toBe('findings-reference');
  });
  it('no declared reference needs no witness and creates no refusal', () => {
    expect(findingsReferenceRefusal(undefined, undefined, 1)).toBeUndefined();
    expect(findingsReferenceRefusal({ previous: [] }, undefined, 1)).toBeUndefined();
  });
});

it('distinguishes a shown settlement identity from evidence of executed work', () => {
  const source = {
    ...result('settled'),
    notDispatched: { pausedCall: { toolCallId: 'other', toolName: 'fixture' } },
  } as LLMMessage;
  const witness = captureFindingsRequest(request([result('settled')]), [source], 1);
  expect(referenceObservation(witness, 1, 'settled')).toMatchObject({
    identified: true,
    execution: 'not-dispatched',
    reason: 'not-a-result',
    visibility: 'unknown',
  });
  expect(findingsReferenceRefusal(declaration('settled'), witness, 1)).toContain('not dispatched');
});

it('an arbitrary changed body has unknown visibility rather than inventing a ticket', () => {
  const source = result('c1', 'original body');
  const sent = result('c1', 'custom shortened summary');
  expect(
    referenceObservation(captureFindingsRequest(request([sent]), [source], 1), 1, 'c1'),
  ).toMatchObject({ identified: true, execution: 'result', visibility: 'unknown' });
  expect(
    findingsReferenceRefusal(
      declaration('c1'),
      captureFindingsRequest(request([sent]), [source], 1),
      1,
    ),
  ).toBeUndefined();
});

it('malformed or ambiguous saved witnesses stay unknown instead of granting or throwing', () => {
  const source = result('c1');
  const valid = captureFindingsRequest(request([source]), [source], 1);
  for (const changed of [
    { results: null },
    { results: {} },
    { complete: 1 },
    { results: [null] },
    { results: [...valid.results, ...valid.results] },
  ]) {
    const malformed = { ...valid, ...changed } as unknown as typeof valid;
    expect(() => findingsReferenceRefusal(declaration('c1'), malformed, 1)).not.toThrow();
    expect(findingsReferenceRefusal(declaration('c1'), malformed, 1)).toContain(
      'findings-reference',
    );
  }
});

it('a byte-identical executed body shaped like a ticket remains body data, including invalid ticket refs', () => {
  for (const ref of [17, 'body-owned-ref']) {
    const source = result(
      'c1',
      JSON.stringify({ collapsed: true, standing: 'fact', toolCallId: 'arbitrary', ref }),
    );
    const witness = captureFindingsRequest(request([source]), [source], 1);
    expect(referenceObservation(witness, 1, 'c1')).toMatchObject({
      identified: true,
      execution: 'result',
      visibility: 'body',
    });
    expect(referenceObservation(witness, 1, 'c1')).not.toHaveProperty('ref');
    expect(findingsReferenceRefusal(declaration('c1'), witness, 1)).toBeUndefined();
  }
});
