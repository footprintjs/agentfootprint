import { describe, expect, it } from 'vitest';
import { requestInput } from '../../../src/index.js';
import {
  applyInputResponse,
  stampInputRequest,
  validateInputDeclaration,
} from '../../../src/core/inputRequest.js';

const declaration = {
  id: 'window',
  question: 'Timezone?',
  fields: [
    { id: 'year', type: 'number' as const },
    { id: 'zone', type: 'string' as const, enum: ['UTC', 'America/Chicago'] },
    { id: 'includeIdle', type: 'boolean' as const, required: false },
  ],
  supplied: { year: 2026 },
  context: { source: 'collector', defaults: { year: 'current-year' } },
};
const waiting = () =>
  stampInputRequest(declaration, 'run:call', {
    originalRequest: 'Inspect the window.',
    toolCallId: 'call',
  });

describe('input request vocabulary', () => {
  it('does not pause a request with no missing required fields', () => {
    expect(() =>
      requestInput({
        id: 'x',
        question: 'Year?',
        fields: [{ id: 'year', type: 'number' }],
        supplied: { year: 2026 },
      }),
    ).toThrow(/no required fields are missing/);
    expect(() =>
      requestInput({
        id: 'x',
        question: 'Year?',
        fields: [{ id: 'year', type: 'number', required: false }],
      }),
    ).toThrow(/no required fields are missing/);
  });
  it('keeps declared defaults distinct from responses and preserves opaque context', () => {
    const request = waiting();
    expect(request.missing).toEqual(['zone']);
    expect(request.origins).toEqual({ year: 'declaration' });
    const response = applyInputResponse(request, {
      requestId: 'run:call',
      values: { zone: 'UTC', includeIdle: false },
    });
    expect(response).toMatchObject({
      missing: [],
      supplied: { year: 2026, zone: 'UTC', includeIdle: false },
      origins: { year: 'declaration', zone: 'response', includeIdle: 'response' },
      context: declaration.context,
    });
    expect(request.supplied).toEqual({ year: 2026 });
  });
  it.each([
    { requestId: 'run:call', values: { zone: 'Mars' } },
    { requestId: 'run:call', values: { year: NaN } },
    { requestId: 'run:call', values: { year: '2026' } },
    { requestId: 'run:call', values: { zone: 'UTC' }, context: { source: 'forged' } },
    { requestId: 'run:call', values: { zone: 'UTC' }, origin: { skillId: 'forged' } },
    { requestId: 'run:call', values: {} },
    { requestId: 'run:call', values: { zone: 'UTC' }, cancel: true },
  ])('refuses unsupported or forged responses %j', (response) => {
    expect(() => applyInputResponse(waiting(), response)).toThrow();
  });
  it('detaches the declaration, choices and context from later caller mutation', () => {
    const value = structuredClone(declaration);
    const request = stampInputRequest(value, 'id', { originalRequest: 'x', toolCallId: 'call' });
    value.context.source = 'changed';
    value.fields[1]!.enum!.push('mutated');
    expect(request.context?.source).toBe('collector');
    expect(request.fields[1]!.enum).not.toContain('mutated');
  });
  it.each([
    { ...declaration, fields: [] },
    { ...declaration, fields: [{ id: 'year', type: ['number'] }] },
    { ...declaration, fields: [declaration.fields[0], declaration.fields[0]] },
    { ...declaration, supplied: { year: Infinity } },
    { ...declaration, context: { bad: () => true } },
  ])('refuses malformed author declarations', (value) => {
    expect(() => validateInputDeclaration(value)).toThrow();
  });
});
