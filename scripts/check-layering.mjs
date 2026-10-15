#!/usr/bin/env node
/**
 * check-layering.mjs — the fence, as a report.
 *
 * Reads every `.ts` file under `src/`, works out which imports survive compilation (the
 * RUNTIME edges), and checks them against the layer table in `layering.config.cjs`. The
 * fence is CLOSED: no upward runtime edge is allowed, and none may be named.
 *
 *   FAILS on
 *   1. unassigned files    — a src file no layer pattern matches (or two match equally);
 *   2. split folders       — a top-level folder of `src/` whose files sit at more than one
 *                            layer (each folder is exactly one layer);
 *   3. upward edges        — a runtime import of a file in a HIGHER layer;
 *   4. reopened allowances — any entry in UPWARD_ALLOWANCES (it must stay empty);
 *   5. type-only upward    — an upward type-only import not named in TYPE_ONLY_ALLOWANCES,
 *                            and a stale or duplicate entry there (the list only shrinks);
 *   6. closed folders      — a runtime import out of a CLOSED_FOLDERS set;
 *   7. barrels             — a statement in a BARREL_FILES file that is not `export … from`;
 *   8. folder cycles       — a value-level cycle between top-level folders (the root
 *                            `src/*.ts` modules are ONE node, `(root)`);
 *   9. unresolved imports  — a relative specifier that names no file at all, so an edge
 *                            cannot drop out of the analysis unseen.
 *
 *   REPORTS (never fails)
 *   - file-level value cycles;
 *   - the folder cycles that type-only edges add (`folderCyclesWithTypes`).
 *
 * An import counts as runtime exactly when `ts.transpileModule` keeps it — the same elision
 * `tsc` applies. A dynamic `import()` is a lazy edge: counted for layering, NOT for cycles
 * (it cannot close a load-time cycle). `import type`, an elided import and an
 * `import('x').T` type reference are type-only edges.
 *
 * Usage:
 *   node scripts/check-layering.mjs [--root <dir>] [--json]
 *     --root  analyse <dir>/src instead of this repo's (with this repo's table)
 *     --json  machine-readable result
 * Exit code: 0 clean, 1 any failure.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const defaultConfig = require('./layering.config.cjs');

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── the graph ────────────────────────────────────────────────────────────────

/** `src/<dir>/…` → `<dir>`; `src/<file>.ts` → `(root)`. */
export function folderOf(file) {
  const parts = file.split('/');
  return parts.length > 2 ? parts[1] : '(root)';
}

/**
 * Every import edge between files of the tree: `{ from, to, kind, line }`, files
 * repo-relative, `kind` one of `value` (survives compilation), `type` (erased), `dynamic`
 * (a lazy `import()`). Only relative specifiers that resolve to a listed file are edges
 * (`layering.config.cjs · resolveRelative`); a relative specifier naming another file that
 * exists (a `.json` module) is not an edge, and one that names nothing is pushed onto
 * `unresolved` as `{ from, spec, line }`.
 */
export function readEdges(root, files, unresolved = []) {
  const known = new Set(files);
  const resolveSpec = (from, spec, line) => {
    const to = defaultConfig.resolveRelative(from, spec, (candidate) => known.has(candidate));
    if (to !== null || !spec.startsWith('.')) return to;
    const literal = join(root, dirname(from), spec);
    if (!(existsSync(literal) && statSync(literal).isFile())) unresolved.push({ from, spec, line });
    return null;
  };
  const edges = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const kept = ts
      .createSourceFile(
        'out.js',
        ts.transpileModule(text, {
          fileName: file,
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        ts.ScriptTarget.ES2022,
        true,
      )
      .statements.filter(
        (s) => (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier,
      )
      .map((s) => s.moduleSpecifier.text);
    let next = 0;
    for (const statement of source.statements) {
      if (
        !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier
      )
        continue;
      const spec = statement.moduleSpecifier.text;
      // The transpile only ever REMOVES statements, in order, so the kept list lines up with the
      // source one for one. `import type` / `export type` are always erased: decide those by syntax
      // and leave the kept list alone, so a type import placed BEFORE a value import of the same
      // module is not credited with the value import's slot.
      const erased =
        (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true) ||
        (ts.isExportDeclaration(statement) && statement.isTypeOnly);
      let kind = 'type';
      if (!erased && kept[next] === spec) {
        kind = 'value';
        next++;
      }
      const to = resolveSpec(file, spec, lineOf(statement));
      if (to) edges.push({ from: file, to, kind, line: lineOf(statement) });
    }
    if (next !== kept.length) {
      throw new Error(
        `check-layering: could not line up the compiled imports of ${file} with its source`,
      );
    }
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const to = resolveSpec(file, node.arguments[0].text, lineOf(node));
        if (to) edges.push({ from: file, to, kind: 'dynamic', line: lineOf(node) });
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        const to = resolveSpec(file, node.argument.literal.text, lineOf(node));
        if (to) edges.push({ from: file, to, kind: 'type', line: lineOf(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return edges;
}

/**
 * Every top-level statement of a barrel file that is not an `export … from '…'`:
 * `{ file, line, text }`, `text` the statement's first line.
 */
export function barrelStatements(root, files) {
  const found = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(root, file), 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
    );
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) continue;
      found.push({
        file,
        line: source.getLineAndCharacterOfPosition(statement.getStart()).line + 1,
        text: statement.getText(source).split('\n')[0].slice(0, 80),
      });
    }
  }
  return found;
}

/** Tarjan. Returns the strongly connected components with more than one member, each sorted. */
export function cycles(nodes, adjacency) {
  let counter = 0;
  const stack = [];
  const onStack = new Set();
  const index = new Map();
  const low = new Map();
  const found = [];
  const visit = (v) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) found.push(component.sort());
    }
  };
  for (const v of nodes) if (!index.has(v)) visit(v);
  return found;
}

const adjacencyOf = (edges, nodeOf) => {
  const adjacency = new Map();
  for (const e of edges) {
    const a = nodeOf(e.from);
    const b = nodeOf(e.to);
    if (a === b) continue;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  }
  return adjacency;
};

// ── the analysis ─────────────────────────────────────────────────────────────

/**
 * @param {{ root?: string, config?: object }} [options] `config` shape: see layering.config.cjs
 *   (`layers`, `upwardAllowances`, `typeOnlyAllowances`, `closedFolders`, `barrelFiles`).
 */
export function analyse({ root = REPO_ROOT, config = {} } = {}) {
  const layers = config.layers ?? defaultConfig.LAYERS;
  const upwardAllowances = config.upwardAllowances ?? defaultConfig.UPWARD_ALLOWANCES;
  const typeOnlyAllowances = config.typeOnlyAllowances ?? defaultConfig.TYPE_ONLY_ALLOWANCES;
  const closedFolders = config.closedFolders ?? defaultConfig.CLOSED_FOLDERS;
  const barrelFiles = config.barrelFiles ?? defaultConfig.BARREL_FILES;
  const compiled = defaultConfig.compileLayers(layers);
  const matchesAny = (globs, f) => globs.some((glob) => defaultConfig.globToRegExp(glob).test(f));

  const files = defaultConfig.listSourceFiles(root);
  const ambiguous = [];
  const rank = new Map(
    files.map((f) => {
      try {
        return [f, defaultConfig.rankOf(f, compiled)];
      } catch (error) {
        ambiguous.push(error.message);
        return [f, null];
      }
    }),
  );
  const unassigned = files.filter((f) => rank.get(f) === null);
  const unresolved = [];
  const edges = readEdges(root, files, unresolved);
  const runtime = edges.filter((e) => e.kind === 'value' || e.kind === 'dynamic');
  const eager = edges.filter((e) => e.kind === 'value');
  const layered = (e) => rank.get(e.from) !== null && rank.get(e.to) !== null;
  const isUpward = (e) => layered(e) && rank.get(e.to) > rank.get(e.from);

  // The folder law: every top-level folder is exactly one layer.
  const folders = [...new Set(files.map(folderOf))].sort();
  const splitFolders = folders
    .map((folder) => ({
      folder,
      layers: [
        ...new Set(
          files
            .filter((f) => folderOf(f) === folder && rank.get(f) !== null)
            .map((f) => rank.get(f)),
        ),
      ].sort((a, b) => a - b),
    }))
    .filter((s) => s.layers.length > 1);

  const folderCycles = cycles(folders, adjacencyOf(eager, folderOf));
  const folderCyclesWithTypes = cycles(
    folders,
    adjacencyOf(
      edges.filter((e) => e.kind !== 'dynamic'),
      folderOf,
    ),
  );
  const fileCycles = cycles(
    files,
    adjacencyOf(eager, (f) => f),
  );

  // Runtime: none upward, and none may be named.
  const upward = runtime
    .filter(isUpward)
    .map((e) => ({ ...e, fromRank: rank.get(e.from), toRank: rank.get(e.to) }));
  const reopenedAllowances = upwardAllowances.map(([from, to]) => ({ from, to }));

  // Type-only: every upward one named, every name live.
  const pairKey = (from, to) => `${from} -> ${to}`;
  const named = new Set(typeOnlyAllowances.map((a) => pairKey(a.from, a.to)));
  const typeUpward = edges
    .filter((e) => e.kind === 'type' && isUpward(e))
    .map((e) => ({
      ...e,
      fromRank: rank.get(e.from),
      toRank: rank.get(e.to),
      named: named.has(pairKey(e.from, e.to)),
    }));
  const typeUnnamed = typeUpward.filter((e) => !e.named);
  const typeUpwardPairs = new Set(typeUpward.map((e) => pairKey(e.from, e.to)));
  const between = (a, kinds) =>
    edges.filter((e) => e.from === a.from && e.to === a.to && kinds.includes(e.kind));
  const staleTypeAllowances = typeOnlyAllowances
    .filter(
      (a) =>
        !typeUpwardPairs.has(pairKey(a.from, a.to)) || between(a, ['value', 'dynamic']).length > 0,
    )
    .map((a) => ({
      from: a.from,
      to: a.to,
      why:
        between(a, ['value', 'dynamic']).length > 0
          ? 'is a RUNTIME import now — the allowance covers type-only imports'
          : between(a, ['type']).length > 0
          ? 'is no longer upward under the table'
          : 'no such type-only import exists any more',
    }));
  const duplicateTypeAllowances = typeOnlyAllowances
    .map((a) => pairKey(a.from, a.to))
    .filter((key, i, all) => all.indexOf(key) !== i);

  const closedEscapes = closedFolders.flatMap((set) => {
    const inSet = (f) => matchesAny(set.files, f);
    return runtime
      .filter((e) => inSet(e.from) && !inSet(e.to))
      .map((e) => ({ ...e, closed: set.name }));
  });

  const barrels = barrelStatements(
    root,
    files.filter((f) => matchesAny(barrelFiles, f)),
  );

  const result = {
    files: files.length,
    folders: folders.length,
    edges: {
      runtime: eager.length,
      lazy: edges.filter((e) => e.kind === 'dynamic').length,
      typeOnly: edges.filter((e) => e.kind === 'type').length,
    },
    folderCycles,
    folderCyclesWithTypes,
    fileCycles,
    splitFolders,
    upward,
    reopenedAllowances,
    typeUpward,
    typeUnnamed,
    typeAllowances: typeOnlyAllowances.length,
    staleTypeAllowances,
    duplicateTypeAllowances,
    unassigned,
    ambiguous,
    closedEscapes,
    barrelStatements: barrels,
    unresolved,
  };
  result.ok =
    unassigned.length === 0 &&
    splitFolders.length === 0 &&
    upward.length === 0 &&
    reopenedAllowances.length === 0 &&
    typeUnnamed.length === 0 &&
    staleTypeAllowances.length === 0 &&
    duplicateTypeAllowances.length === 0 &&
    closedEscapes.length === 0 &&
    barrels.length === 0 &&
    folderCycles.length === 0 &&
    unresolved.length === 0;
  return result;
}

// ── the report ───────────────────────────────────────────────────────────────

const short = (f) => f.replace(/^src\//, '');
const members = (cs) => cs.reduce((n, c) => n + c.length, 0);

export function format(result) {
  const lines = [];
  const e = result.edges;
  lines.push(
    `check-layering: ${result.files} files in ${result.folders} folders, ${
      e.runtime + e.lazy + e.typeOnly
    } import edges (${e.runtime} runtime, ${e.lazy} lazy, ${e.typeOnly} type-only)`,
  );
  lines.push('');
  lines.push(
    `folders in a value-level cycle: ${members(result.folderCycles)} of ${result.folders}` +
      `   with type-only edges (reported): ${members(result.folderCyclesWithTypes)} of ${
        result.folders
      }   file cycles (value-level, reported): ${result.fileCycles.length}`,
  );
  for (const c of result.folderCycles) lines.push(`  folder cycle: ${c.join(', ')}   [FAIL]`);
  lines.push('');
  lines.push(
    `upward runtime edges: ${result.upward.length}   upward allowances: ${result.reopenedAllowances.length} (the fence is closed: must be 0)`,
  );
  for (const u of result.upward) {
    lines.push(
      `  ${short(u.from)}:${u.line} (L${u.fromRank}) -> ${short(u.to)} (L${
        u.toRank
      })   [NOT ALLOWED]`,
    );
  }
  for (const a of result.reopenedAllowances)
    lines.push(
      `  allowance: ${short(a.from)} -> ${short(a.to)}   [UPWARD_ALLOWANCES must stay empty]`,
    );
  lines.push('');
  lines.push(
    `type-only upward imports: ${result.typeUpward.length}   named: ${result.typeAllowances}   not named: ${result.typeUnnamed.length}   stale: ${result.staleTypeAllowances.length}   duplicate: ${result.duplicateTypeAllowances.length}`,
  );
  for (const t of result.typeUnnamed) {
    lines.push(
      `  ${short(t.from)}:${t.line} (L${t.fromRank}) -> ${short(t.to)} (L${
        t.toRank
      })   [NOT NAMED: move the type down, or name it in TYPE_ONLY_ALLOWANCES with a reason]`,
    );
  }
  for (const s of result.staleTypeAllowances)
    lines.push(`  stale: ${short(s.from)} -> ${short(s.to)}  ${s.why}`);
  for (const d of result.duplicateTypeAllowances) lines.push(`  duplicate: ${d}`);
  lines.push('');
  lines.push(
    `unassigned files: ${result.unassigned.length}   split folders: ${result.splitFolders.length}   closed-folder escapes: ${result.closedEscapes.length}   barrel statements: ${result.barrelStatements.length}   unresolved imports: ${result.unresolved.length}`,
  );
  for (const a of result.ambiguous) lines.push(`  ${a}`);
  for (const f of result.unassigned.filter(
    (f) => !result.ambiguous.some((a) => a.includes(`"${f}"`)),
  ))
    lines.push(`  unassigned: ${f}  (add it to LAYERS in scripts/layering.config.cjs)`);
  for (const s of result.splitFolders)
    lines.push(
      `  split: src/${s.folder}/ sits at L${s.layers.join(
        ', L',
      )}   [a folder is exactly one layer]`,
    );
  for (const c of result.closedEscapes)
    lines.push(
      `  ${short(c.from)}:${c.line} -> ${short(c.to)}   [${c.closed} imports only itself]`,
    );
  for (const b of result.barrelStatements)
    lines.push(`  ${short(b.file)}:${b.line} ${b.text}   [a barrel holds only \`export … from\`]`);
  for (const u of result.unresolved)
    lines.push(`  ${short(u.from)}:${u.line} -> '${u.spec}'   [names no file]`);
  lines.push('');
  lines.push(result.ok ? 'OK' : 'FAIL');
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at === -1 ? REPO_ROOT : resolve(args[at + 1]);
  const result = analyse({ root });
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : format(result));
  // exitCode, not exit(): a large `--json` piped elsewhere must flush before the process ends.
  process.exitCode = result.ok ? 0 : 1;
}
