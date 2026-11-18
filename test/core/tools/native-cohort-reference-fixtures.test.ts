/** Static migration proof only; hosted whole-record scenarios remain the runtime oracle. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { NativeWindowAddition } from './native-cohort-metadata.js';

const base = new URL('./reference/', import.meta.url);
const current = new URL('v15-native-cohort/', base);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const native = 'v14-native-components/';
const findings = 'findings-reference-context/';
const sources = 'source-contract-projection/';
const originals: Record<string, string> = {
  'agent-answer-layer': native,
  'agent-arguments-ask-resumed': native,
  'agent-arguments-ask': native,
  'agent-arguments-assume-limits': native,
  'agent-arguments-assume': native,
  'agent-arguments-sources-only': sources,
  'agent-arguments-sources': sources,
  'agent-dynamic-graph-hop': native,
  'agent-dynamic-static-tool': native,
  'agent-findings-contingent': findings,
  'agent-findings-judge': findings,
  'agent-findings-window': findings,
  'agent-findings': findings,
  'agent-from-active-skill': native,
  'agent-message-api-chart-one-turn': '',
  'agent-ontology': native,
  'agent-parked-map': native,
  'agent-provider-three-sources': native,
  'agent-results-period': native,
  'agent-scoped-provider': native,
  'agent-script-artifact': native,
  'agent-shared-tool-reference': native,
  'agent-stepped-skill': native,
  'agent-time-clock': native,
  'agent-tool-choice': native,
  'agent-tool-forced': native,
  'agent-wrap-up': native,
  'message-api-chart': '',
};
type Capture = {
  case: string;
  previousFile: string;
  previousSha256: string;
  currentSha256: string;
  additions: NativeWindowAddition[];
};
type Manifest = {
  contract: string;
  evidence: {
    runId: number;
    jobId: number;
    sourceHead: string;
    testedCheckout: string;
    failureLabels: number;
    sharedDiffGroups: number;
    uniqueDiffAddedLines: number;
    perCaptureAddedFields: number;
    deletedLines: number;
  };
  captures: Capture[];
  preservedJson: { file: string; sha256: string }[];
  preservedDocumentation: { file: string; sha256: string }[];
};
const manifest = JSON.parse(readFileSync(new URL('MANIFEST.json', current), 'utf8')) as Manifest;

type ProjectedRecord = { commitLog: Record<string, unknown>[]; [key: string]: unknown };
function undoListedAdditions(value: ProjectedRecord, additions: NativeWindowAddition[]) {
  const prior = structuredClone(value);
  const seen = new Set<string>();
  for (const addition of additions) {
    const match = /^\/commitLog\/(0|[1-9][0-9]*)\/(beganAt|sawUntil)$/.exec(addition.pointer);
    assert(match && !seen.has(addition.pointer), 'unique direct metadata pointer required');
    seen.add(addition.pointer);
    const bundle = prior.commitLog[Number(match[1])];
    const key = match[2]!;
    assert(bundle && Object.hasOwn(bundle, key), 'listed addition must exist');
    assert.deepEqual(bundle[key], addition.value, 'listed value must match exactly');
    delete bundle[key];
  }
  return prior;
}

it('binds exactly the 28 actual hosted failures, with both shared-diff cases accounted for', () => {
  expect(manifest.contract).toBe('v15-native-read-window-additions-v1');
  expect(manifest.evidence).toMatchObject({
    runId: 44159054587,
    jobId: 134307614013,
    sourceHead: 'b7b5155435104013c4ee27fadfd8c0fcc91473d3',
    testedCheckout: '8cf705547334c6e9c09ad68e3935b30d7cd6565b',
    failureLabels: 28,
    sharedDiffGroups: 27,
    uniqueDiffAddedLines: 151,
    perCaptureAddedFields: 155,
    deletedLines: 0,
  });
  expect(manifest.captures.map((entry) => entry.case).sort()).toEqual(
    Object.keys(originals).sort(),
  );
  expect(
    readdirSync(current)
      .filter((name) => name.endsWith('.json'))
      .sort(),
  ).toEqual(['MANIFEST.json', ...Object.keys(originals).map((name) => `${name}.json`)].sort());
  expect(manifest.captures.reduce((n, entry) => n + entry.additions.length, 0)).toBe(155);
});

for (const entry of manifest.captures) {
  it(`${entry.case}: only listed direct metadata was added to the complete prior record`, () => {
    expect(entry.previousFile).toBe(`${originals[entry.case]}${entry.case}.json`);
    const oldBytes = readFileSync(new URL(entry.previousFile, base));
    const newBytes = readFileSync(new URL(`${entry.case}.json`, current));
    expect(digest(oldBytes)).toBe(entry.previousSha256);
    expect(digest(newBytes)).toBe(entry.currentSha256);
    const before = JSON.parse(oldBytes.toString()) as ProjectedRecord;
    const after = JSON.parse(newBytes.toString()) as ProjectedRecord;
    expect(entry.additions.length).toBeGreaterThan(0);
    for (const addition of entry.additions) {
      const match = /^\/commitLog\/(0|[1-9][0-9]*)\/(beganAt|sawUntil)$/.exec(addition.pointer);
      expect(match).not.toBeNull();
      const index = Number(match![1]);
      const key = match![2]!;
      expect(Object.hasOwn(before.commitLog[index]!, key)).toBe(false);
      if (key === 'beganAt') expect(addition.value).toBe('<volatile>');
      else {
        expect([3, 27, 44]).toContain(addition.value);
        expect(Number.isInteger(addition.value)).toBe(true);
        expect(addition.value).toBeGreaterThanOrEqual(0);
        // Foottrace 2 permits sawUntil == idx. Raw beganAt is checked before normalization.
        expect(addition.value).toBeLessThanOrEqual(after.commitLog[index]!.idx as number);
      }
    }
    expect(undoListedAdditions(after, entry.additions)).toEqual(before);
    // Keep array order, every served view, and every other payload field in this comparison.
    expect(JSON.parse(newBytes.toString())).toEqual(after);
  });
}

it('keeps all 69 historical JSON files and their documentation byte-identical', () => {
  expect(manifest.preservedJson).toHaveLength(69);
  const folders = [
    'v14-native-components',
    'findings-reference-context',
    'source-contract-projection',
  ];
  const inventory = [
    ...readdirSync(base).filter((file) => file.endsWith('.json')),
    ...folders.flatMap((folder) =>
      readdirSync(new URL(`${folder}/`, base))
        .filter((file) => file.endsWith('.json'))
        .map((file) => `${folder}/${file}`),
    ),
  ];
  expect(manifest.preservedJson.map((entry) => entry.file).sort()).toEqual(inventory.sort());
  expect(manifest.preservedDocumentation.map((entry) => entry.file).sort()).toEqual(
    folders.map((folder) => `${folder}/README.md`).sort(),
  );
  for (const entry of [...manifest.preservedJson, ...manifest.preservedDocumentation])
    expect(digest(readFileSync(new URL(entry.file, base))), entry.file).toBe(entry.sha256);
});

it('does not erase same-named business data or excuse any other changed value', () => {
  const before = {
    commitLog: [{ idx: 3, overwrite: { beganAt: 'business time', sawUntil: 90 } }],
    served: [{ view: { beganAt: 'business time', sawUntil: 90 } }],
  };
  const after: ProjectedRecord = structuredClone(before);
  after.commitLog[0]!.beganAt = '<volatile>';
  const additions: NativeWindowAddition[] = [
    { pointer: '/commitLog/0/beganAt', value: '<volatile>' },
  ];
  expect(undoListedAdditions(after, additions)).toEqual(before);
  (after.commitLog[0]!.overwrite as Record<string, unknown>).beganAt = 'changed business time';
  expect(undoListedAdditions(after, additions)).not.toEqual(before);
  expect(() =>
    undoListedAdditions(after, [
      { pointer: '/commitLog/0/overwrite/beganAt', value: '<volatile>' },
    ]),
  ).toThrow('unique direct metadata pointer required');
  expect(() => undoListedAdditions(after, [...additions, ...additions])).toThrow();
});
