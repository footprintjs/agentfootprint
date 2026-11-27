import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const canonical = new URL('../src/time/instant.ts', import.meta.url);
const output = new URL('../src/llm-ledger/instantParser.ts', import.meta.url);
const source = ts.createSourceFile(
  'instant.ts',
  readFileSync(canonical, 'utf8'),
  ts.ScriptTarget.Latest,
);
const parser = source.statements.findIndex(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'instantOf',
);
if (parser === -1) throw new Error('Cannot find the canonical instant parser.');

const body = source.statements
  .slice(0, parser + 1)
  .filter((node) => !(ts.isTypeAliasDeclaration(node) && node.name.text === 'InstantText'))
  .map((node) => {
    const text = node.getFullText(source);
    if (node === source.statements[parser] || !ts.canHaveModifiers(node)) return text;
    const exported = ts
      .getModifiers(node)
      ?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported === undefined) return text;
    const from = exported.getStart(source) - node.getFullStart();
    const to = exported.end - node.getFullStart();
    return text.slice(0, from) + text.slice(to).trimStart();
  })
  .join('')
  .trimStart();
const generated =
  '// Generated from src/time/instant.ts by scripts/gen-ledger-instant.mjs.\n\n' + body + '\n';

if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== generated)
    throw new Error('Ledger parser is stale. Run node scripts/gen-ledger-instant.mjs.');
} else {
  writeFileSync(output, generated);
}
