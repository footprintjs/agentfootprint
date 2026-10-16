/**
 * The record-ownership scan, shared by `recordOwnership.test.ts` and its own
 * child process.
 *
 * WHY A CHILD PROCESS: the whole-tree scan reads every source file and parses
 * the ones that import footprintjs. It touches no library code, so instrumenting
 * it measures nothing — but the v8 coverage run profiles every function in the
 * worker, TypeScript's parser included, and that made this one scan the slowest
 * test in the coverage pass (it timed out at 30 s in the release workflow).
 * Run as `node recordOwnershipScan.mjs <root> <dir>…`, it prints
 * `{ files, found }` as JSON from a plain, uninstrumented process.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/** Every name a published Foottrace door declares, values and types alike. */
export function recordNamesOf() {
  const manifest = require.resolve('foottrace/package.json');
  const doors = Object.values(JSON.parse(readFileSync(manifest, 'utf8')).exports);
  const entries = doors.flatMap((door) =>
    typeof door !== 'string' && door.require?.types
      ? [resolve(dirname(manifest), door.require.types)]
      : [],
  );
  const program = ts.createProgram(entries, { skipLibCheck: true });
  const checker = program.getTypeChecker();
  const names = new Set(
    entries.flatMap((entry) =>
      checker
        .getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(entry)))
        .map((s) => s.name),
    ),
  );
  return { entries, names };
}

/**
 * The cheap gate in front of the parser. Every name `misplaced` can report sits
 * under a string-literal module specifier that begins `footprintjs` — quoted
 * `'…'` or `"…"`, never a template — so a file whose text never spells that
 * cannot report anything and is not parsed. Most of the tree never imports
 * footprintjs at all. Limit: a specifier written with escape sequences
 * (`'\x66ootprintjs'`) is not seen; nobody imports a package that way.
 */
const MAY_NAME_FOOTPRINT = /['"]footprintjs['"/]/;
const FOOTPRINT_SPECIFIER = /^footprintjs(?:\/|$)/;

/** The record names `text` takes from a footprintjs door instead of from Foottrace. */
export function misplaced(text, fileName, recordNames) {
  if (!MAY_NAME_FOOTPRINT.test(text)) return [];
  // No parent links: the walk below only descends, so it never reads `.parent`.
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  const found = [];
  const inspect = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      FOOTPRINT_SPECIFIER.test(node.moduleSpecifier.text)
    ) {
      const bindings = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        for (const item of bindings.elements) {
          const name = (item.propertyName ?? item.name).text;
          if (recordNames.has(name)) found.push(name);
        }
      }
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      FOOTPRINT_SPECIFIER.test(node.argument.literal.text) &&
      node.qualifier &&
      ts.isIdentifier(node.qualifier) &&
      recordNames.has(node.qualifier.text)
    ) {
      found.push(node.qualifier.text);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return found;
}

/** Every JS/TS source file under `dir`, recursively. */
export function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    return item.isDirectory() ? sources(path) : /\.(?:[cm]?[jt]sx?)$/.test(path) ? [path] : [];
  });
}

/** Each file read once; `found` lists `<file>: <name>` for every misplaced name. */
export function scanTree(root, dirs) {
  const { names } = recordNamesOf();
  const files = dirs.flatMap((dir) => sources(join(root, dir)));
  const found = files.flatMap((file) =>
    misplaced(readFileSync(file, 'utf8'), file, names).map((name) => `${file}: ${name}`),
  );
  return { files, found };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, ...dirs] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(scanTree(root, dirs)));
}
