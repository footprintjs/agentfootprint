/**
 * Examples smoke test — imports every example under examples/ and
 * invokes its `run()` function with the meta.defaultInput. Catches:
 *
 *   - Type-level breakage (the import itself fails to resolve)
 *   - Contract violations (missing `run` or `meta` exports)
 *   - Runtime breakage (the example throws when invoked with its own
 *     scripted mock provider — the default contract)
 *
 * Replaces the previous gate-5 dependency on agent-samples/npm-run-all.
 *
 * The smoke test does NOT swap in real providers — that's the playground's
 * job. Here we only verify each example works with its own default mock.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const examplesRoot = join(__dirname, '..', 'examples');

function listExampleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // Skip non-example artifacts.
    if (entry === 'helpers' || entry === 'tsconfig.json') continue;
    if (entry.endsWith('.md')) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...listExampleFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const exampleFiles = listExampleFiles(examplesRoot).sort();

describe('examples smoke test', () => {
  it('discovers example files', () => {
    expect(exampleFiles.length).toBeGreaterThan(20);
  });

  for (const file of exampleFiles) {
    const rel = relative(examplesRoot, file);

    it(`${rel} — imports, exports run + meta, and runs to completion`, async () => {
      const mod = await import(pathToFileURL(file).href);

      expect(typeof mod.run).toBe('function');
      expect(mod.meta).toBeDefined();
      expect(typeof mod.meta.id).toBe('string');
      expect(typeof mod.meta.title).toBe('string');
      expect(typeof mod.meta.group).toBe('string');
      expect(Array.isArray(mod.meta.providerSlots)).toBe(true);
      expect(Array.isArray(mod.meta.tags)).toBe(true);

      // Invoke with the example's own defaultInput. No provider passed →
      // the example uses its scripted mock, which we expect to succeed.
      const input = mod.meta.defaultInput ?? '';
      const result = await mod.run(input);

      // Most examples return an object; some return a string. Both fine.
      expect(result === undefined || result === null).toBe(false);
    }, 20_000);
  }
});
