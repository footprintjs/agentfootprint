import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const root = new URL('./reference/', import.meta.url);
const current = 'v15-assembled-cohort';
const captures = [
  { case: 'agent-answer-layer', previousCohort: 'step-completion-evidence', beganAtLines: 6 },
  { case: 'agent-scoped-provider', previousCohort: 'tool-outcome-marker', beganAtLines: 8 },
  { case: 'agent-stepped-skill', previousCohort: 'step-completion-evidence', beganAtLines: 6 },
] as const;
const read = (path: string) => readFileSync(new URL(path, root));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const beganAtLine = /^ {6}"beganAt": "<volatile>",\n/gm;

it('binds the three assembled captures to their retained reference files', () => {
  const json = readdirSync(new URL(`${current}/`, root)).filter((file) => file.endsWith('.json'));
  expect(json.sort()).toEqual([
    'MANIFEST.json',
    ...captures.map(({ case: name }) => `${name}.json`),
  ]);
  expect(JSON.parse(read(`${current}/MANIFEST.json`).toString('utf8'))).toEqual({
    captures: captures.map((entry) => ({
      ...entry,
      previousSha256: digest(read(`${entry.previousCohort}/${entry.case}.json`)),
      currentSha256: digest(read(`${current}/${entry.case}.json`)),
    })),
  });
});

it.each(captures)('$case adds only $beganAtLines normalized beganAt lines', (entry) => {
  const prior = read(`${entry.previousCohort}/${entry.case}.json`);
  const assembled = read(`${current}/${entry.case}.json`).toString('utf8');
  expect(prior.toString('utf8')).not.toMatch(/"beganAt":/);
  expect(assembled.match(beganAtLine)).toHaveLength(entry.beganAtLines);
  expect(Buffer.from(assembled.replace(beganAtLine, ''), 'utf8')).toEqual(prior);
});
