/**
 * Examples smoke test — imports every example under examples/ and
 * invokes its `run()` function with the meta.defaultInput. Catches:
 *
 *   - Type-level breakage (the import itself fails to resolve)
 *   - Contract violations (missing `run` or `meta` exports)
 *   - Runtime breakage (the example throws when invoked with its own
 *     scripted mock provider)
 *   - **Behavior regressions** via `toMatchSnapshot()` on the sanitized
 *     result — if a library change silently alters an example's output
 *     (tool count, iteration count, branch selection, etc.) the snapshot
 *     diff fails loudly and forces the author to either fix the example
 *     or update the golden with `npm test -- -u`.
 *
 * Replaces the previous gate-5 dependency on agent-samples/npm-run-all.
 *
 * Non-determinism (timestamps, latencies, ephemeral IDs) is scrubbed
 * before snapshot comparison so CI stays green across machines and runs.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const examplesRoot = join(__dirname, '..', 'examples');

function listExampleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
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

/**
 * Replace non-deterministic fields with stable tokens so snapshot
 * comparison is reproducible across machines, Node versions, and runs.
 * The token strings are intentionally distinctive so accidental matches
 * on real data are easy to spot in a snapshot review.
 */
function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return '[TIMESTAMP]';
    if (/^tr_\d+$/.test(value)) return '[TRACE_ID]';
    return value;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => sanitize(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/latency.?ms$/i.test(k) || /^elapsed(ms)?$/i.test(k) || /^duration(ms)?$/i.test(k)) {
      out[k] = '[LATENCY]';
    } else if (k === 'exportedAt' || k === 'timestamp' || k === 'startedAt' || k === 'endedAt') {
      out[k] = '[TIMESTAMP]';
    } else if (k === 'traceId' && typeof v === 'string' && v.startsWith('tr_')) {
      out[k] = '[TRACE_ID]';
    } else if (k === 'sizeKb' && typeof v === 'number') {
      out[k] = Math.round(v);
    } else {
      out[k] = sanitize(v, seen);
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

    it(`${rel} — imports, exports run + meta`, async () => {
      const mod = await import(pathToFileURL(file).href);

      expect(typeof mod.run).toBe('function');
      expect(mod.meta).toBeDefined();
      expect(typeof mod.meta.id).toBe('string');
      expect(typeof mod.meta.title).toBe('string');
      expect(typeof mod.meta.group).toBe('string');
      expect(Array.isArray(mod.meta.providerSlots)).toBe(true);
      expect(Array.isArray(mod.meta.tags)).toBe(true);
    });

    it(`${rel} — runs + output matches snapshot`, async () => {
      const mod = await import(pathToFileURL(file).href);
      const input = mod.meta.defaultInput ?? '';
      const result = await mod.run(input);

      expect(result === undefined || result === null).toBe(false);
      expect(sanitize(result)).toMatchSnapshot();
    }, 20_000);
  }
});
