import { readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { productionSources } from '../../../../test/helpers/productionSources.js';

const OWNER = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(OWNER, '../../..');
const FACADE = resolve(OWNER, '../otel.ts');
const inside = (path: string): boolean => path.startsWith(OWNER + '/');
const OWNER_NAME = basename(OWNER);

function edges(file: string, text = readFileSync(file, 'utf8')): string[] {
  return ts
    .preProcessFile(text, true, true)
    .importedFiles.flatMap(({ fileName }) =>
      fileName.startsWith('.') ? [resolve(dirname(file), fileName.replace(/\.js$/, '.ts'))] : [],
    );
}

function ownerEdges(file: string, text = readFileSync(file, 'utf8')): string[] {
  // A relative path from outside the owner must name its directory. Any escape
  // still reaches the scanner, including a line continuation or escaped letter.
  if (!text.includes(OWNER_NAME) && !text.includes('\\')) return [];
  return edges(file, text).filter(inside);
}

describe('OTel implementation ownership', () => {
  it('reads static, re-exported, dynamic and import-type owner edges', () => {
    const file = resolve(SRC, 'owner-probe.ts');
    const text = [
      "import type { A } from './adapters/observability/otel/types.js';",
      "export { B } from './adapters/observability/otel/strategy.js';",
      "const owner = import('./adapters/observability/otel/spans/writer.js');",
      "type Owner = import('./adapters/observability/otel/turns/state.js').Owner;",
    ].join('\n');
    expect(edges(file, text)).toEqual([
      resolve(OWNER, 'types.ts'),
      resolve(OWNER, 'strategy.ts'),
      resolve(OWNER, 'spans/writer.ts'),
      resolve(OWNER, 'turns/state.ts'),
    ]);
  });

  it('ignores import-shaped comments and strings and keeps escaped module paths', () => {
    const file = resolve(SRC, 'owner-probe.ts');
    const text = [
      "// import { A } from './adapters/observability/otel/types.js';",
      'const text = "import { A } from \'./adapters/observability/otel/types.js\'";',
      String.raw`export type { A } from './adapters/observability/otel/\u0074ypes.js';`,
    ].join('\n');
    expect(edges(file, text)).toEqual([resolve(OWNER, 'types.ts')]);
  });

  it('keeps escaped owner names in the fast boundary scan', () => {
    const file = resolve(SRC, 'owner-probe.ts');
    const text = String.raw`export type { A } from './adapters/observability/o\u0074el/types.js';`;
    expect(text.includes(OWNER_NAME)).toBe(false);
    expect(ownerEdges(file, text)).toEqual([resolve(OWNER, 'types.ts')]);
    expect(ownerEdges(file, "import { A } from './other/types.js';")).toEqual([]);
  });

  it('all production callers enter through the public facade', () => {
    const leaks = productionSources(SRC)
      .filter((file) => file !== FACADE && !inside(file))
      .flatMap((file) =>
        ownerEdges(file)
          .filter(inside)
          .map((target) => `${relative(SRC, file)} -> ${relative(SRC, target)}`),
      );
    expect(leaks).toEqual([]);
  });

  it('owners never import the facade or each other in a cycle, including type edges', () => {
    const files = productionSources(OWNER);
    const graph = new Map(files.map((file) => [file, edges(file)]));
    expect(files.filter((file) => graph.get(file)?.includes(FACADE))).toEqual([]);
    const visited = new Set<string>();
    function visit(file: string, active: string[]): void {
      expect(active, `cycle through ${relative(OWNER, file)}`).not.toContain(file);
      if (visited.has(file)) return;
      for (const target of graph.get(file) ?? [])
        if (inside(target)) visit(target, [...active, file]);
      visited.add(file);
    }
    files.forEach((file) => visit(file, []));
  });
});
