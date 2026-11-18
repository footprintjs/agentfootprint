/** Current findings captures never overwrite the frozen native migration proof. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const current = new URL('./reference/findings-reference-context/', import.meta.url);
const historical = new URL('./reference/v14-native-components/', import.meta.url);
const cases = [
  'agent-arguments-sources',
  'agent-findings',
  'agent-findings-contingent',
  'agent-findings-judge',
  'agent-findings-window',
];
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

it('binds exactly five complete current-context captures to their frozen historical pairs', () => {
  const manifest = JSON.parse(readFileSync(new URL('MANIFEST.json', current), 'utf8')) as {
    layout: string;
    captures: { case: string; historicalSha256: string; currentSha256: string }[];
  };
  expect(manifest.layout).toBe('late-v2');
  expect(manifest.captures.map((entry) => entry.case).sort()).toEqual(cases);
  expect(
    readdirSync(current)
      .filter((file) => file.endsWith('.json'))
      .sort(),
  ).toEqual(['MANIFEST.json', ...cases.map((name) => `${name}.json`)].sort());
  for (const entry of manifest.captures) {
    expect(
      digest(readFileSync(new URL(`${entry.case}.json`, historical))),
      entry.case + ' historical',
    ).toBe(entry.historicalSha256);
    expect(
      digest(readFileSync(new URL(`${entry.case}.json`, current))),
      entry.case + ' current',
    ).toBe(entry.currentSha256);
  }
});
