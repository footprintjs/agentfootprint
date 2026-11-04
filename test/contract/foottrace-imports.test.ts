import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importedFoottrace } from '../../contract/foottrace.imports.mjs';

function withSource<T>(files: Record<string, string>, read: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'af-foottrace-imports-'));
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(root, name), source);
    return read(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the Foottrace source-import inventory', () => {
  it('keeps named symbol coverage when a facade also loads the same module for its effects', () => {
    const imports = withSource(
      {
        'a-facade.ts': "import 'foottrace'; import 'foottrace/cause';",
        'z-leaf.ts':
          "import { causalChain as chain, type CommitBundle } from 'foottrace'; " +
          "export { explain as explainCause } from 'foottrace/cause';",
      },
      importedFoottrace,
    );
    expect(imports.map(({ module, name, typeOnly }) => ({ module, name, typeOnly }))).toEqual([
      { module: 'foottrace', name: 'causalChain', typeOnly: false },
      { module: 'foottrace', name: 'CommitBundle', typeOnly: true },
      { module: 'foottrace/cause', name: 'explain', typeOnly: false },
    ]);
  });

  it('refuses a bare subpath that has no named-symbol contract in the source tree', () => {
    expect(() =>
      withSource(
        {
          'facade.ts': "import { causalChain } from 'foottrace'; import 'foottrace/uncovered';",
        },
        importedFoottrace,
      ),
    ).toThrow(/Add contract coverage.*Foottrace/);
  });

  it('refuses a bare module whose companion bindings are only types', () => {
    expect(() =>
      withSource(
        {
          'facade.ts': "import 'foottrace'; import type { CommitBundle } from 'foottrace';",
        },
        importedFoottrace,
      ),
    ).toThrow(/Add contract coverage.*Foottrace/);
  });

  it('does not count an empty import clause as runtime-symbol coverage', () => {
    expect(() =>
      withSource(
        {
          'facade.ts':
            "import 'foottrace'; import {} from 'foottrace'; " +
            "import { explain } from 'foottrace/cause';",
        },
        importedFoottrace,
      ),
    ).toThrow(/Add contract coverage.*Foottrace/);
  });

  it.each([
    "import ft from 'foottrace';",
    "import * as ft from 'foottrace';",
    "export * from 'foottrace';",
    "type Chain = import('foottrace').CausalChain;",
    "import ft = require('foottrace');",
    "const ft = import('foottrace');",
    "const ft = require('foottrace');",
  ])('still refuses an unenumerated symbol surface: %s', (source) => {
    expect(() => withSource({ 'reader.ts': source }, importedFoottrace)).toThrow(
      /Add contract coverage/,
    );
  });

  it('refuses a tree with only bare loads and no enumerated symbols', () => {
    expect(() => withSource({ 'facade.ts': "import 'foottrace';" }, importedFoottrace)).toThrow(
      /Foottrace/,
    );
  });
});
