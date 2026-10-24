/**
 * Record names have one home: Foottrace. Derive the names from its published
 * declarations, not a second hand-maintained list. Engine names remain on
 * FootPrint. This also checks examples, benchmarks and executable docs demos.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs module, no types; it is also the child process below
import { misplaced as misplacedIn, recordNamesOf } from './recordOwnershipScan.mjs';

const root = resolve(__dirname, '../..');
const SCAN = join(__dirname, 'recordOwnershipScan.mjs');
const { entries, names: recordNames } = recordNamesOf() as {
  entries: string[];
  names: Set<string>;
};
const misplaced = (text: string, fileName = 'input.ts'): string[] =>
  misplacedIn(text, fileName, recordNames);

describe('canonical record ownership', () => {
  it('derives both values and types from every published Foottrace door', () => {
    // Foottrace can add doors without changing who owns existing record names.
    // Check every installed declaration, rather than pinning a release's count.
    const manifestPath = createRequire(import.meta.url).resolve('foottrace/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports: Record<string, string | { require?: { types?: string } }>;
    };
    const publishedDeclarations = Object.values(manifest.exports).flatMap((door) =>
      typeof door !== 'string' && door.require?.types
        ? [resolve(dirname(manifestPath), door.require.types)]
        : [],
    );
    expect(entries).toEqual(publishedDeclarations);
    for (const name of [
      'CommitValuesMode',
      'ControlDepLookup',
      'CommitBundle',
      'commitValueAt',
      'SharedMemory',
      'setNestedValue',
      'pathSegments',
      'CauseGraph',
      'TraversalLimits',
    ]) {
      expect(recordNames.has(name), name).toBe(true);
    }
    expect(recordNames.has('controlDepRecorder')).toBe(false);
  });

  it('catches aliases, re-exports and inline type imports, while allowing engine names', () => {
    expect(
      misplaced(`
        import { commitValueAt as read, controlDepRecorder } from 'footprintjs/trace';
        export type { CommitBundle as Row } from 'footprintjs/trace';
        type Mode = import('footprintjs').CommitValuesMode;
        import { SharedMemory } from 'footprintjs/write';
        import { pathSegments } from 'footprintjs/trace';
        export { setNestedValue } from 'footprintjs/advanced';
        import type { ControlDepLookup } from 'foottrace';
      `),
    ).toEqual([
      'commitValueAt',
      'CommitBundle',
      'CommitValuesMode',
      'SharedMemory',
      'pathSegments',
      'setNestedValue',
    ]);
  });

  it('parses executable JSX demos using their actual source format', () => {
    expect(
      misplaced(
        `const Demo = () => <section><span>Replay</span></section>;
         import { commitValueAt } from 'footprintjs/trace';`,
        'Demo.tsx',
      ),
    ).toEqual(['commitValueAt']);
  });

  it('source, tests, examples, benchmarks and docs demos take every record name from its owner', () => {
    // Run in a plain `node` child: the scan reads files and touches no library
    // code, so the coverage run's instrumentation would only slow it down.
    const run = spawnSync(
      process.execPath,
      [
        SCAN,
        root,
        'src',
        'test',
        'examples',
        'bench',
        'docs-next/scripts',
        'docs-next/components',
        'docs-next/lib',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    expect(run.status, run.stderr).toBe(0);
    const { files, found } = JSON.parse(run.stdout) as { files: string[]; found: string[] };
    expect(files.length).toBeGreaterThan(100);
    for (const demo of [
      'docs-next/scripts/gen-replay-trace.mjs',
      'docs-next/scripts/gen-context-walkthrough.mjs',
      'docs-next/components/SubflowLensTryItInner.tsx',
    ]) {
      expect(files, `${demo} must stay inside the ownership check`).toContain(join(root, demo));
    }
    expect(found).toEqual([]);
  });
});
