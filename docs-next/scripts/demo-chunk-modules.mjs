/**
 * demo-chunk-modules — WHICH library modules ride the deferred demo chunk.
 *
 * check-site-budget.mjs ratchets one number (the gzip sum of the demo's async
 * assets). When that number moves, this script says what moved: it reads the
 * per-module webpack stats the docs build writes under DOCS_WEBPACK_STATS=1
 * (see next.config.mjs) and prints every module in the demo's async assets,
 * grouped by library folder, largest first.
 *
 *   DOCS_WEBPACK_STATS=1 EXPORT=true npm run build
 *   node scripts/demo-chunk-modules.mjs            # top 40 modules
 *   node scripts/demo-chunk-modules.mjs --groups   # bytes per library folder
 *   node scripts/demo-chunk-modules.mjs --all      # every module
 *
 * Bytes are pre-minification module sizes (webpack's `size`), so they rank
 * modules against each other; the ratcheted number is post-minify gzip.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const statsFile = path.join(projectRoot, '.next/webpack-stats-client.json');
const manifestFile = path.join(projectRoot, '.next/react-loadable-manifest.json');
const args = new Set(process.argv.slice(2));

if (!existsSync(statsFile)) {
  console.error(`missing ${statsFile} — build with DOCS_WEBPACK_STATS=1 first`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const entry = Object.entries(manifest).find(([key]) => key.includes('SkillGraphTryItInner'))?.[1];
if (!entry?.files) {
  console.error('SkillGraphTryItInner is not in the React loadable manifest');
  process.exit(1);
}
const demoAssets = new Set(entry.files.map((file) => file.replace(/^static\//, '')));

const stats = JSON.parse(readFileSync(statsFile, 'utf8'));
const chunkIds = new Set(
  stats.chunks
    .filter((chunk) => chunk.files.some((file) => demoAssets.has(file.replace(/^static\//, ''))))
    .map((chunk) => chunk.id),
);
// The top-level module list, not `chunk.modules`: webpack groups the latter
// ("dependent modules", "+ N modules") and the groups hide the files.
const chunks = [
  { modules: stats.modules.filter((m) => (m.chunks ?? []).some((id) => chunkIds.has(id))) },
];

/** Flattens concatenated modules so each source file counts once. */
function leaves(module) {
  if (Array.isArray(module.modules) && module.modules.length > 0) return module.modules.flatMap(leaves);
  return [module];
}

function label(name) {
  if (!name) return '(unnamed)';
  const lib = name.match(/\.\.\/dist\/esm\/(.+)$/);
  if (lib) return `af:${lib[1]}`;
  const fp = name.match(/footprintjs\/dist\/esm\/(.+)$/);
  if (fp) return `fp:${fp[1]}`;
  const dep = name.match(/node_modules\/(.+)$/);
  if (dep) return `dep:${dep[1]}`;
  return name;
}

const byModule = new Map();
for (const chunk of chunks) {
  for (const module of chunk.modules ?? []) {
    for (const leaf of leaves(module)) {
      const key = label(leaf.name ?? leaf.identifier);
      byModule.set(key, Math.max(byModule.get(key) ?? 0, leaf.size ?? 0));
    }
  }
}

const rows = [...byModule.entries()].sort((a, b) => b[1] - a[1]);
const total = rows.reduce((sum, [, bytes]) => sum + bytes, 0);
const libraryRows = rows.filter(([name]) => name.startsWith('af:') || name.startsWith('fp:'));
const libraryTotal = libraryRows.reduce((sum, [, bytes]) => sum + bytes, 0);

console.log(
  `demo chunk: ${chunkIds.size} chunks, ${rows.length} modules, ${total.toLocaleString()} B pre-minify ` +
    `(library: ${libraryRows.length} modules, ${libraryTotal.toLocaleString()} B)`,
);

if (args.has('--groups')) {
  const groups = new Map();
  for (const [name, bytes] of libraryRows) {
    const parts = name.split('/');
    const group = parts.length > 2 ? parts.slice(0, 2).join('/') : name;
    groups.set(group, (groups.get(group) ?? 0) + bytes);
  }
  for (const [group, bytes] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(bytes).padStart(9)}  ${group}`);
  }
} else {
  const limit = args.has('--all') ? rows.length : 40;
  for (const [name, bytes] of rows.slice(0, limit)) console.log(`${String(bytes).padStart(9)}  ${name}`);
}
