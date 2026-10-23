/** Oversized prose is unassessed, not a partially checked prefix or unbounded record work. */
import { describe, expect, it, vi } from 'vitest';

import { MAX_NEGATIVE_CLAIMS } from '../../../src/integrity/negative-claim/judge.js';
import { NEGATIVE_CLAIM_PHRASES_VERSION } from '../../../src/integrity/negative-claim/phrases.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import { incidentCall, turnRecord } from './fixtures.js';

const SENTENCE = 'The incident store has no open incidents on payments in the last 2 hours.';
const field = 'summary';
const record = turnRecord([incidentCall()]);
const repeated = (count: number) => Array.from({ length: count }, () => SENTENCE).join(' ');
const overflowNote = (text: string) => ({
  kind: 'negative-claim-note',
  field,
  code: 'too-many-claims',
  span: { start: 0, end: text.length },
  packVersion: NEGATIVE_CLAIM_PHRASES_VERSION,
});

describe('the prose field claim limit', () => {
  it.each([0, MAX_NEGATIVE_CLAIMS - 1, MAX_NEGATIVE_CLAIMS])(
    'judges every claim when there are %i',
    (count) => {
      const rows = judgeProseNegatives({ field, text: repeated(count), record });
      expect(rows).toHaveLength(count);
      for (const row of rows)
        expect(row).toMatchObject({
          kind: 'negative-claim',
          notes: [],
          results: [record.calls[0]?.resultId],
        });
    },
  );

  it('replaces an overflowing field with one note, even when every claim repeats', () => {
    const text = repeated(MAX_NEGATIVE_CLAIMS + 1);
    expect(judgeProseNegatives({ field, text, record })).toEqual([overflowNote(text)]);
  });

  it.each([MAX_NEGATIVE_CLAIMS + 1, 16_000])(
    'does no record work when %i claims exceed the limit',
    (count) => {
      const readCalls = vi.fn(() => {
        throw new Error('An overflowing prose field must not read the tool record.');
      });
      const unread = {
        ...record,
        get calls() {
          return readCalls();
        },
      };
      const text = repeated(count);
      expect(judgeProseNegatives({ field, text, record: unread })).toEqual([overflowNote(text)]);
      expect(readCalls).not.toHaveBeenCalled();
    },
  );

  it('counts both claim kinds, including two claims in one sentence', () => {
    const both = 'There are no incidents and these are all the hosts.';
    const text = `${repeated(MAX_NEGATIVE_CLAIMS - 1)} ${both}`;
    expect(judgeProseNegatives({ field, text, record })).toEqual([overflowNote(text)]);
  });

  it('keeps code and language notes below the claim limit', () => {
    const text = `No hay incidentes abiertos en payments.\n\n\`\`\`\nthere are no incidents\n\`\`\`\n\n${repeated(
      MAX_NEGATIVE_CLAIMS,
    )}`;
    const rows = judgeProseNegatives({ field, text, record });
    expect(rows.filter((row) => row.kind === 'negative-claim')).toHaveLength(MAX_NEGATIVE_CLAIMS);
    expect(rows.filter((row) => row.kind === 'negative-claim-note').map((row) => row.code)).toEqual(
      ['language-unsupported', 'in-code-block'],
    );
  });

  it('emits only the overflow note when an overflowing field also has other notes', () => {
    const text = `No hay incidentes abiertos en payments.\n\n\`\`\`\nthere are no incidents\n\`\`\`\n\n${repeated(
      MAX_NEGATIVE_CLAIMS + 1,
    )}`;
    expect(judgeProseNegatives({ field, text, record })).toEqual([overflowNote(text)]);
  });
});
