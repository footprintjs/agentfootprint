/** Source-contract captures bind new complete records without rewriting prior evidence. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const base = new URL('./reference/', import.meta.url);
const current = new URL('source-contract-projection/', base);
const cases = {
  'agent-arguments-sources': 'findings-reference-context',
  'agent-arguments-sources-only': 'v14-native-components',
};
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const manifest = () =>
  JSON.parse(readFileSync(new URL('MANIFEST.json', current), 'utf8')) as {
    contract: string;
    captures: {
      case: keyof typeof cases;
      previousCohort: string;
      previousSha256: string;
      currentSha256: string;
    }[];
    preservedJson: { file: string; sha256: string }[];
  };

it('binds only the two complete opted-in source captures to their actual prior cohorts', () => {
  const recorded = manifest();
  expect(recorded.contract).toBe('required-source-envelope-v1');
  expect(recorded.captures.map((entry) => entry.case).sort()).toEqual(Object.keys(cases));
  expect(
    readdirSync(current)
      .filter((file) => file.endsWith('.json'))
      .sort(),
  ).toEqual(['MANIFEST.json', ...Object.keys(cases).map((name) => `${name}.json`)].sort());
  for (const entry of recorded.captures) {
    expect(entry.previousCohort).toBe(cases[entry.case]);
    expect(
      digest(readFileSync(new URL(`${entry.previousCohort}/${entry.case}.json`, base))),
      entry.case + ' prior capture',
    ).toBe(entry.previousSha256);
    expect(
      digest(readFileSync(new URL(`${entry.case}.json`, current))),
      entry.case + ' current capture',
    ).toBe(entry.currentSha256);
  }
});

it('preserves every earlier JSON capture and both original manifests byte-for-byte', () => {
  const retained = manifest().preservedJson;
  expect(retained).toHaveLength(66);
  expect(new Set(retained.map((entry) => entry.file)).size).toBe(66);
  expect(retained.map((entry) => entry.file)).toContain('v14-native-components/MANIFEST.json');
  expect(retained.map((entry) => entry.file)).toContain('findings-reference-context/MANIFEST.json');
  const files = [
    ...readdirSync(base).filter((file) => file.endsWith('.json')),
    ...['v14-native-components', 'findings-reference-context'].flatMap((folder) =>
      readdirSync(new URL(folder + '/', base))
        .filter((file) => file.endsWith('.json'))
        .map((file) => `${folder}/${file}`),
    ),
  ];
  expect(retained.map((entry) => entry.file).sort()).toEqual(files.sort());
  for (const entry of retained)
    expect(digest(readFileSync(new URL(entry.file, base))), entry.file).toBe(entry.sha256);
});
