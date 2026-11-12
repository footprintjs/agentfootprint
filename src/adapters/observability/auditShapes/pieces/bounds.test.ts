import { describe, expect, it } from 'vitest';
import { boundScripts } from './scripts.js';
import { boundRequestEnd } from './requests.js';
import { boundSemantics } from './semantics.js';
import { boundMeta } from './meta.js';

describe('shared audit bounds', () => {
  it('keeps script references and fences while marking program text and undeclared children', () => {
    expect(
      boundScripts({
        shown: [
          {
            toolCallId: 'call',
            text: 'private',
            label: 'submitted',
            exitCode: 0,
            unknown: 'private',
          },
        ],
        omitted: 2,
        closedFence: { char: 'tilde', length: 4 },
      }),
    ).toEqual({
      shown: [
        {
          toolCallId: 'call',
          text: '[7 chars]',
          label: 'submitted',
          exitCode: 0,
          unknown: '[7 chars]',
        },
      ],
      omitted: 2,
      closedFence: { char: 'tilde', length: 4 },
    });
  });

  it('keeps only the fixed request error sentences and declared categories', () => {
    expect(
      boundRequestEnd({
        outcome: 'failed',
        failure: 'network',
        attempts: 2,
        error: { message: 'private', code: 'network' },
        remote: 'private',
      }),
    ).toEqual({
      outcome: 'failed',
      failure: 'network',
      attempts: 2,
      error: { message: '[7 chars]', code: 'network' },
      remote: '[7 chars]',
    });
    const message = 'The request failed before an answer arrived. Its error is not kept.';
    expect(boundRequestEnd({ error: { message, code: 'timeout' } })).toEqual({
      error: { message, code: 'timeout' },
    });
  });

  it('keeps semantic field names and null paging, and bounds open record values', () => {
    expect(
      boundSemantics({
        facts: [{ entity: 'private', value: 'private' }],
        paging: { next: null },
        render: { columns: ['name'], filter_note: 'private' },
      }),
    ).toEqual({
      facts: [{ entity: '[7 chars]', value: '[7 chars]' }],
      paging: { next: null },
      render: { columns: ['name'], filter_note: '[7 chars]' },
    });
  });

  it('retains a hostile own key as bounded data without changing the output prototype', () => {
    const result = boundMeta(JSON.parse('{"runId":"run","__proto__":"private"}')) as object;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe('[7 chars]');
    expect(Object.keys(result)).toEqual(['runId', '__proto__']);
  });
});
