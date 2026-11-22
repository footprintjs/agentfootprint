import { describe, expect, it } from 'vitest';
import type { CodeTruncation } from '../../provider-contract/types.js';
import { clipOutput } from './output.js';

const ADVICE =
  'characters. Re-run printing a summary, a slice, or an aggregate instead of the whole value.]';
const BASE = { stdout: 'abcdef', stderr: '01234' };

describe('measured code output', () => {
  it.each([0, 1, 2])('leaves a stream of %i characters at or below the cap intact', (length) => {
    const stream = 'ab'.slice(0, length);
    expect(clipOutput({ stdout: stream, stderr: stream }, 2)).toEqual({
      stdout: stream,
      stderr: stream,
    });
  });

  it('counts both kept streams and excludes the truncation notice', () => {
    expect(clipOutput(BASE, 4)).toEqual({
      stdout: 'abcd\n[truncated: showing 4 of 6 ' + ADVICE,
      stderr: '0123\n[truncated: showing 4 of 5 ' + ADVICE,
      counts: { kept: 8, total: 11, unit: 'characters' },
    });
  });

  it('counts uncut stderr while numbering a cut on stdout', () => {
    expect(clipOutput({ ...BASE, stderr: '01' }, 4)).toEqual({
      stdout: 'abcd\n[truncated: showing 4 of 6 ' + ADVICE,
      stderr: '01',
      counts: { kept: 6, total: 8, unit: 'characters' },
    });
  });

  it('preserves the local note and uses the measured upstream total', () => {
    expect(clipOutput({ ...BASE, truncated: { stdout: true, ofChars: 10 } }, 4)).toEqual({
      stdout: 'abcd\n[truncated: showing 4 of 6 ' + ADVICE,
      stderr: '0123\n[truncated: showing 4 of 5 ' + ADVICE,
      counts: { kept: 8, total: 15, unit: 'characters' },
    });
  });

  it('counts an upstream cut whose retained output fits the tool cap', () => {
    expect(clipOutput({ ...BASE, truncated: { stderr: true, ofChars: 12 } }, 8)).toEqual({
      stdout: BASE.stdout,
      stderr: '01234\n[truncated: showing 5 ' + ADVICE,
      counts: { kept: 11, total: 18, unit: 'characters' },
    });
  });

  const unknown: readonly { readonly truncated: CodeTruncation; readonly label: string }[] = [
    { label: 'missing total', truncated: { stdout: true } },
    {
      label: 'single maximum for two streams',
      truncated: { stdout: true, stderr: true, ofChars: 10 },
    },
    { label: 'negative total', truncated: { stdout: true, ofChars: -1 } },
    { label: 'total equal to the returned stream', truncated: { stdout: true, ofChars: 6 } },
    { label: 'total smaller than the returned stream', truncated: { stdout: true, ofChars: 2 } },
    { label: 'fractional total', truncated: { stdout: true, ofChars: 10.5 } },
    { label: 'infinite total', truncated: { stdout: true, ofChars: Infinity } },
    {
      label: 'unsafe combined total',
      truncated: { stdout: true, ofChars: Number.MAX_SAFE_INTEGER },
    },
  ];

  it.each(unknown)('omits an unproven original total with $label', ({ truncated }) => {
    expect(clipOutput({ ...BASE, truncated }, 4).counts).toEqual({ kept: 8, unit: 'characters' });
  });

  it('ignores a reported length when neither stream was flagged upstream', () => {
    expect(clipOutput({ ...BASE, truncated: { ofChars: 99 } }, 4).counts).toEqual({
      kept: 8,
      total: 11,
      unit: 'characters',
    });
  });

  it('preserves the existing zero-cap and UTF-16 boundaries', () => {
    expect(clipOutput({ stdout: 'a', stderr: '' }, 0)).toEqual({
      stdout: '\n[truncated: showing 0 of 1 ' + ADVICE,
      stderr: '',
      counts: { kept: 0, total: 1, unit: 'characters' },
    });
    expect(clipOutput({ stdout: '💡', stderr: '' }, 1)).toEqual({
      stdout: '\ud83d\n[truncated: showing 1 of 2 ' + ADVICE,
      stderr: '',
      counts: { kept: 1, total: 2, unit: 'characters' },
    });
  });
});
