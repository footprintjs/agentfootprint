import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

import {
  appZones,
  cells,
  classifyPhrase,
  phrases,
  processZones,
} from '../../bench/time/proven-forms/manifest.mjs';
import { verify } from '../../bench/time/proven-forms/verify.mjs';
import { provenLookback } from '../../src/time/provenForms/proof.js';

const benchmark = 'bench/time/proven-forms';
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('T4 runtime proof and the accepted offline measurement', () => {
  it('matches the declared cases, runtime identity, receipt and exact measured worker', () => {
    const archive = readFileSync(`${benchmark}/results.json.gz`);
    const identity = JSON.parse(readFileSync(`${benchmark}/identity.json`, 'utf8'));
    const { rows, identity: observed } = JSON.parse(gunzipSync(archive).toString('utf8'));
    const manifest = processZones.flatMap(cells);
    const worker = buildSync({
      entryPoints: [`${benchmark}/measure.mjs`],
      write: false,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      treeShaking: true,
      logOverride: { 'ignored-bare-import': 'silent' },
    }).outputFiles[0];
    expect(sha256(archive)).toBe(provenLookback.receipt);
    expect(sha256(JSON.stringify(manifest))).toBe(provenLookback.manifest);
    expect(sha256(readFileSync(`${benchmark}/manifest.mjs`))).toBe(provenLookback.grammar);
    expect(sha256(worker.contents)).toBe(provenLookback.worker);
    expect(provenLookback.reader).toEqual({ ...identity.reader, locale: 'en-US' });
    expect(provenLookback.runtime).toEqual({
      node: identity.node.slice(1),
      tz: identity.tz,
      icu: identity.icu,
    });
    const verdict = verify(manifest, rows, identity, observed);
    expect(verdict.lookback.qualifies).toBe(true);
    expect(verdict.range.qualifies).toBe(false);
    expect(
      phrases.map(({ text }) => text).filter((text) => classifyPhrase(text) === 'lookback'),
    ).toEqual(provenLookback.phrases);
    expect(appZones).toEqual(provenLookback.appZones);
    expect(processZones).toEqual(provenLookback.processZones);
  });
});
