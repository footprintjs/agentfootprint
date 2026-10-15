#!/usr/bin/env node
/**
 * check-layering.mjs — the fence, as a report.
 *
 * Reads every `.ts` file under `src/`, works out which imports survive compilation (the
 * RUNTIME edges), and checks them against the layer table in `layering.config.cjs`:
 *
 *   FAILS on
 *   1. unassigned files   — a src file no layer pattern matches (or two match equally);
 *   2. upward edges       — a runtime import of a file in a HIGHER layer that is not in
 *                           UPWARD_ALLOWANCES;
 *   3. stale allowances   — a UPWARD_ALLOWANCES entry that is no longer an upward runtime
 *                           edge (deleted, type-only now, or downward after a move): the
 *                           list only shrinks, so an entry cannot outlive its edge;
 *   4. closed folders     — a runtime import out of a CLOSED_FOLDERS set.
 *
 *   REPORTS (never fails, today)
 *   - the folder-level value cycle: the strongly connected components of the graph whose
 *     nodes are the top-level folders of `src/` (the root `src/*.ts` modules are ONE node,
 *     `(root)`), counting eager value edges only;
 *   - file-level value cycles;
 *   - type-only upward imports.
 *
 * An import counts as runtime exactly when `ts.transpileModule` keeps it — the same elision
 * `tsc` applies. A dynamic `import()` is a lazy edge: counted for layering, NOT for cycles
 * (it cannot close a load-time cycle). `import type`, an elided import and an
 * `import('x').T` type reference are type-only edges.
 *
 * Usage:
 *   node scripts/check-layering.mjs [--root <dir>] [--json] [--allowances]
 *     --root        analyse <dir>/src instead of this repo's
 *     --json        machine-readable result
 *     --allowances  print every upward runtime edge as UPWARD_ALLOWANCES entries
 * Exit code: 0 clean, 1 any failure.
 */

import { readFileSync } from 'node:fs';
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
 * (a lazy `import()`). Only relative specifiers that resolve to a listed file are edges.
 */
export function readEdges(root, files) {
  const known = new Set(files);
  const resolveSpec = (from, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = join(dirname(from), spec.replace(/\.js$/, '')).split('\\').join('/');
    for (const candidate of [base + '.ts', base + '/index.ts']) if (known.has(candidate)) return candidate;
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
      .statements.filter((s) => (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier)
      .map((s) => s.moduleSpecifier.text);
    let next = 0;
    for (const statement of source.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier)
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
      const to = resolveSpec(file, spec);
      if (to) edges.push({ from: file, to, kind, line: lineOf(statement) });
    }
    if (next !== kept.length) {
      throw new Error(`check-layering: could not line up the compiled imports of ${file} with its source`);
    }
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const to = resolveSpec(file, node.arguments[0].text);
        if (to) edges.push({ from: file, to, kind: 'dynamic', line: lineOf(node) });
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        const to = resolveSpec(file, node.argument.literal.text);
        if (to) edges.push({ from: file, to, kind: 'type', line: lineOf(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return edges;
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
 *   (`layers`, `upwardAllowances`, `closedFolders`).
 */
export function analyse({ root = REPO_ROOT, config = {} } = {}) {
  const layers = config.layers ?? defaultConfig.LAYERS;
  const allowances = config.upwardAllowances ?? defaultConfig.UPWARD_ALLOWANCES;
  const closedFolders = config.closedFolders ?? defaultConfig.CLOSED_FOLDERS;
  const compiled = defaultConfig.compileLayers(layers);

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
  const edges = readEdges(root, files);
  const runtime = edges.filter((e) => e.kind === 'value' || e.kind === 'dynamic');
  const eager = edges.filter((e) => e.kind === 'value');
  const layered = (e) => rank.get(e.from) !== null && rank.get(e.to) !== null;
  const isUpward = (e) => layered(e) && rank.get(e.to) > rank.get(e.from);

  const folders = [...new Set(files.map(folderOf))].sort();
  const folderCycles = cycles(folders, adjacencyOf(eager, folderOf));
  const fileCycles = cycles(
    files,
    adjacencyOf(eager, (f) => f),
  );

  const pairKey = (from, to) => `${from} -> ${to}`;
  const allowed = new Set(allowances.map(([from, to]) => pairKey(from, to)));
  const upward = runtime
    .filter(isUpward)
    .map((e) => ({ ...e, fromRank: rank.get(e.from), toRank: rank.get(e.to), allowed: allowed.has(pairKey(e.from, e.to)) }));
  const upwardUnnamed = upward.filter((e) => !e.allowed);
  const upwardPairs = new Set(upward.map((e) => pairKey(e.from, e.to)));
  const duplicateAllowances = allowances
    .map(([from, to]) => pairKey(from, to))
    .filter((key, i, all) => all.indexOf(key) !== i);
  const staleAllowances = allowances
    .filter(([from, to]) => !upwardPairs.has(pairKey(from, to)))
    .map(([from, to]) => {
      const live = runtime.some((e) => e.from === from && e.to === to);
      const typeOnly = edges.some((e) => e.from === from && e.to === to);
      return {
        from,
        to,
        why: live
          ? 'is no longer upward under the table'
          : typeOnly
          ? 'is type-only now — not a runtime edge'
          : 'no such import exists any more',
      };
    });

  const typeUpward = edges
    .filter((e) => e.kind === 'type' && isUpward(e))
    .map((e) => ({ ...e, fromRank: rank.get(e.from), toRank: rank.get(e.to) }));

  const closedEscapes = closedFolders.flatMap((set) => {
    const inSet = (f) => set.files.some((glob) => defaultConfig.globToRegExp(glob).test(f));
    return runtime.filter((e) => inSet(e.from) && !inSet(e.to)).map((e) => ({ ...e, closed: set.name }));
  });

  const result = {
    files: files.length,
    folders: folders.length,
    edges: {
      runtime: eager.length,
      lazy: edges.filter((e) => e.kind === 'dynamic').length,
      typeOnly: edges.filter((e) => e.kind === 'type').length,
    },
    folderCycles,
    fileCycles,
    upward,
    upwardUnnamed,
    allowances: allowances.length,
    duplicateAllowances,
    staleAllowances,
    typeUpward,
    unassigned,
    ambiguous,
    closedEscapes,
  };
  result.ok =
    unassigned.length === 0 &&
    upwardUnnamed.length === 0 &&
    staleAllowances.length === 0 &&
    duplicateAllowances.length === 0 &&
    closedEscapes.length === 0;
  return result;
}

// ── the report ───────────────────────────────────────────────────────────────

const short = (f) => f.replace(/^src\//, '');

export function format(result) {
  const lines = [];
  const e = result.edges;
  lines.push(
    `check-layering: ${result.files} files in ${result.folders} folders, ${
      e.runtime + e.lazy + e.typeOnly
    } import edges (${e.runtime} runtime, ${e.lazy} lazy, ${e.typeOnly} type-only)`,
  );
  lines.push('');
  const inCycle = result.folderCycles.reduce((n, c) => n + c.length, 0);
  lines.push(
    `value-level cycles (reported, not failed)   folders in a cycle: ${inCycle} of ${result.folders}   file cycles: ${result.fileCycles.length}`,
  );
  for (const c of result.folderCycles) lines.push(`  folder cycle: ${c.join(', ')}`);
  lines.push('');
  lines.push(
    `upward runtime edges: ${result.upward.length}   allowances: ${result.allowances}   not allowed: ${result.upwardUnnamed.length}`,
  );
  for (const u of result.upwardUnnamed) {
    lines.push(`  ${short(u.from)}:${u.line} (L${u.fromRank}) -> ${short(u.to)} (L${u.toRank})   [NOT ALLOWED]`);
  }
  lines.push('');
  lines.push(
    `stale allowances: ${result.staleAllowances.length}   duplicate allowances: ${result.duplicateAllowances.length}`,
  );
  for (const s of result.staleAllowances) lines.push(`  stale: ${short(s.from)} -> ${short(s.to)}  ${s.why}`);
  for (const d of result.duplicateAllowances) lines.push(`  duplicate: ${d}`);
  lines.push('');
  lines.push(`type-only upward imports (erased by tsc, reported only): ${result.typeUpward.length}`);
  lines.push('');
  lines.push(`unassigned files: ${result.unassigned.length}   closed-folder escapes: ${result.closedEscapes.length}`);
  for (const a of result.ambiguous) lines.push(`  ${a}`);
  for (const f of result.unassigned.filter((f) => !result.ambiguous.some((a) => a.includes(`"${f}"`))))
    lines.push(`  unassigned: ${f}  (add it to LAYERS in scripts/layering.config.cjs)`);
  for (const c of result.closedEscapes)
    lines.push(`  ${short(c.from)}:${c.line} -> ${short(c.to)}   [${c.closed} imports only itself]`);
  lines.push('');
  lines.push(result.ok ? 'OK' : 'FAIL');
  return lines.join('\n');
}

/** Every upward runtime edge as UPWARD_ALLOWANCES entries, one per file pair, sorted. */
export function allowanceEntries(result) {
  const pairs = [...new Set(result.upward.map((u) => JSON.stringify([u.from, u.to])))].sort();
  return pairs.map((p) => `  ${p.replace('","', "', '").replace(/^\["/, "['").replace(/"\]$/, "']")},`).join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at === -1 ? REPO_ROOT : resolve(args[at + 1]);
  const result = analyse({ root });
  if (args.includes('--allowances')) console.log(allowanceEntries(result));
  else console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : format(result));
  process.exit(result.ok ? 0 : 1);
}
