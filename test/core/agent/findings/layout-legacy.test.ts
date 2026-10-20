import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { servedViews } from '../../../../src/index.js';

it('replays the actual public 10.9.0 record with its original enum/system layout', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('./fixtures/layout-legacy-10.9.0.manifest.json', import.meta.url), 'utf8'),
  );
  const compressed = readFileSync(
    new URL('./fixtures/layout-legacy-10.9.0.json.gz', import.meta.url),
  );
  expect(createHash('sha256').update(compressed).digest('hex')).toBe(manifest.gzipSha256);
  const bytes = gunzipSync(compressed, { maxOutputLength: 1_000_000 });
  expect(bytes.length).toBe(manifest.uncompressedBytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.uncompressedSha256);
  const fixture = JSON.parse(bytes.toString('utf8'));
  expect(fixture.sourceVersion).toBe('10.9.0');
  expect(servedViews(fixture.snapshot)).toEqual(fixture.views);
});
