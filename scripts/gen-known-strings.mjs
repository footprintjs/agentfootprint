#!/usr/bin/env node
/**
 * gen-known-strings — writes the two literals of `src/redaction/knownStrings.ts`
 * (the library's own words, and its payloads' field names) from the TYPES that
 * file declares (`LibraryWord`, `FieldName`), so the closed sets are the code's
 * own unions. The compiler then checks the literals exactly against the types:
 * a word added to a payload union does not compile until this is re-run.
 *
 *   node scripts/gen-known-strings.mjs           write the literals
 *   node scripts/gen-known-strings.mjs --check   fail when they are stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(import.meta.url)('typescript');
const file = join(root, 'src/redaction/knownStrings.ts');

const program = ts.createProgram([file], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(file);

/** The string literal members of the exported type alias `name`, sorted. */
function membersOf(name) {
  let members;
  ts.forEachChild(source, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === name) {
      const type = checker.getTypeAtLocation(node.name);
      const parts = type.isUnion() ? type.types : [type];
      members = parts.map((part) => {
        if (!part.isStringLiteral()) throw new Error(`${name}: a member is not a string literal`);
        return part.value;
      });
    }
  });
  if (members === undefined) throw new Error(`no type alias ${name}`);
  return [...new Set(members)].sort();
}

const key = (word) => (/^[A-Za-z_$][\w$]*$/.test(word) ? word : `'${word.replace(/'/g, "\\'")}'`);
/** One entry per line, as the repo's Prettier writes it (printWidth 100: a longer key breaks after the colon). */
const entry = (word) => {
  const line = `  ${key(word)}: true,`;
  return line.length > 100 ? `  ${key(word)}:\n    true,` : line;
};
const literal = (words) => words.map(entry).join('\n');

function fill(text, marker, words) {
  const start = `  // @generated ${marker} — start\n`;
  const end = `  // @generated ${marker} — end`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`markers for ${marker} not found`);
  return text.slice(0, from + start.length) + literal(words) + '\n' + text.slice(to);
}

const current = readFileSync(file, 'utf8');
const next = fill(fill(current, 'words', membersOf('LibraryWord')), 'fields', membersOf('FieldName'));
if (process.argv.includes('--check')) {
  if (next !== current) {
    console.error('src/redaction/knownStrings.ts is stale — run: node scripts/gen-known-strings.mjs');
    process.exit(1);
  }
  console.log('known strings are up to date ✓');
} else {
  writeFileSync(file, next);
  console.log('wrote', file);
}
