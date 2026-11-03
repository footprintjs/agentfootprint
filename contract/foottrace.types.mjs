/** Compile imports freshly generated from source against the installed package's CJS and ESM declarations. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { importedFoottrace } from './foottrace.imports.mjs';

const imports = importedFoottrace();
const unique = [...new Map(imports.map((item) => [`${item.module}:${item.name}`, item])).values()];
const directory = fs.mkdtempSync(new URL('./.foottrace-types-', import.meta.url));
try {
  const source = unique
    .map(
      (item, i) =>
        `import ${item.typeOnly ? 'type ' : ''}{ ${
          item.name
        } as Contract${i} } from ${JSON.stringify(item.module)};`,
    )
    .join('\n');
  for (const extension of ['cts', 'mts']) {
    const filename = path.join(directory, `consumer.${extension}`);
    fs.writeFileSync(filename, source);
    const program = ts.createProgram([filename], {
      noEmit: true,
      strict: true,
      skipLibCheck: false,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ['node'],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      }),
    );
  }
  console.log(`Foottrace type contract: ${unique.length} source-imported symbols, CJS + ESM.`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
