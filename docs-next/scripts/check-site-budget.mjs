import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const outputRoot = path.resolve(process.argv[2] ?? 'out');
const projectRoot = path.resolve(import.meta.dirname, '..');
const failures = [];
const routeInitialAssets = new Map();

const ROUTES = [
  {
    name: 'home',
    file: 'index.html',
    limits: { js: 235_000, css: 34_000, html: 30_000, requests: 20 },
    imagePreloads: { count: 2, bytes: 50_000 },
  },
  {
    name: 'features',
    file: 'features/index.html',
    limits: { js: 225_000, css: 25_000, html: 45_000, requests: 21 },
  },
  {
    name: 'docs',
    file: 'docs/index.html',
    limits: { js: 235_000, css: 20_000, html: 50_000, requests: 22 },
  },
  {
    name: 'skills guide',
    file: 'docs/build/skills-explained/index.html',
    limits: { js: 240_000, css: 20_000, html: 80_000, requests: 24 },
  },
];

const SEARCH_LIMITS = { raw: 12_000_000, gzip: 2_000_000, records: 2_000 };
// Raised for 9.57.0. The generated API reference had been three releases
// stale (the 9.53.0 semantics surface was never regenerated), so this
// release's regeneration added 25 pages at once and the export crossed both
// ceilings — 6,514 files and 127.13 MB of duplicate sibling RSC payloads.
// The ceiling is a RATCHET against growth nobody noticed, and this growth is
// API pages the generator already owed; raising it is the honest response,
// reverting to a lying API reference is not. Headroom is deliberately thin
// so the next unnoticed jump still trips it.
const OUTPUT_LIMITS = { bytes: 700_000_000, files: 6_700, duplicateRscBytes: 132_000_000 };
// Raised for 9.61.0: 394.1 KB → 400.3 KB. The skill-graph demo imports
// `defineTool` from 'agentfootprint', so the library's MAIN ENTRY and its
// whole transitive graph ride this chunk — and this release added the
// Context Integrity family (five checks, the assertion algebra, the
// disposition ledger) to that graph. The growth is real library surface,
// not chunking noise: the payload is the same 16 async assets, each a
// little heavier.
//
// Worth stating plainly, because the number is the evidence: the integrity
// family is NOT tree-shaken out for a browser consumer who enables none of
// it. `zero-delta` is a promise about what a run DOES, never about what a
// bundle WEIGHS, and these are different axes. Making the checks reachable
// only through a dynamic import is the fix if this keeps climbing.
//
// Headroom stays deliberately thin (the ratchet's whole point), so the next
// unnoticed jump still trips it.
const DEMO_ASYNC_GZIP_LIMIT = 405_000;

function formatBytes(bytes) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function fail(message) {
  failures.push(message);
  console.error(`  FAIL ${message}`);
}

function assertAtMost(label, value, limit) {
  if (value > limit) fail(`${label}: ${formatBytes(value)} exceeds ${formatBytes(limit)}`);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
}

function resolveOutputAsset(url) {
  const pathname = decodeURIComponent(url.split(/[?#]/, 1)[0] ?? '').replace(/^\/+/, '');
  if (!pathname) return undefined;

  const candidates = [path.join(outputRoot, pathname)];
  const nextIndex = pathname.indexOf('_next/');
  if (nextIndex >= 0) candidates.push(path.join(outputRoot, pathname.slice(nextIndex)));
  const segments = pathname.split('/');
  if (segments.length > 1) candidates.push(path.join(outputRoot, ...segments.slice(1)));

  return candidates.find((candidate) => candidate.startsWith(outputRoot) && existsSync(candidate));
}

function gzipFile(file) {
  return gzipSync(readFileSync(file), { level: 9 }).byteLength;
}

function requiredOutputAsset(url, label) {
  const file = resolveOutputAsset(url);
  if (!file) fail(`${label}: cannot resolve exported asset ${url}`);
  return file;
}

function uniqueAssetBytes(urls, label, gzip = true) {
  const files = new Set(urls.map((url) => requiredOutputAsset(url, label)).filter(Boolean));
  return [...files].reduce((sum, file) => sum + (gzip ? gzipFile(file) : statSync(file).size), 0);
}

function analyzeRoute(route) {
  const htmlFile = path.join(outputRoot, route.file);
  if (!existsSync(htmlFile)) {
    fail(`${route.name}: missing ${route.file}`);
    return;
  }

  const html = readFileSync(htmlFile, 'utf8');
  const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi)].map((match) => match[0]);
  const modernScripts = scriptTags.filter((tag) => !/\bnomodule\b/i.test(tag));
  const legacyScripts = scriptTags.filter((tag) => /\bnomodule\b/i.test(tag));
  const styles = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)].map((match) => match[0]);
  const imagePreloadTags = [...html.matchAll(/<link\b[^>]*\brel=["']preload["'][^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attribute(tag, 'as')?.toLowerCase() === 'image');

  const scriptUrls = modernScripts.map((tag) => attribute(tag, 'src')).filter(Boolean);
  const legacyUrls = legacyScripts.map((tag) => attribute(tag, 'src')).filter(Boolean);
  const styleUrls = styles.map((tag) => attribute(tag, 'href')).filter(Boolean);
  const jsBytes = uniqueAssetBytes(scriptUrls, `${route.name} script`);
  const legacyJsBytes = uniqueAssetBytes(legacyUrls, `${route.name} legacy script`);
  const cssBytes = uniqueAssetBytes(styleUrls, `${route.name} stylesheet`);
  const htmlBytes = gzipSync(html, { level: 9 }).byteLength;
  const criticalRequests = 1 + new Set(scriptUrls).size + new Set(styleUrls).size + imagePreloadTags.length;

  routeInitialAssets.set(
    route.name,
    new Set([...scriptUrls, ...styleUrls].map(resolveOutputAsset).filter(Boolean)),
  );

  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  if (h1Count !== 1) fail(`${route.name}: expected exactly one H1, found ${h1Count}`);

  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const missingDimensions = images.filter((tag) => !attribute(tag, 'width') || !attribute(tag, 'height'));
  if (missingDimensions.length > 0) {
    fail(`${route.name}: ${missingDimensions.length}/${images.length} images lack intrinsic width and height`);
  }

  console.log(
    `${route.name.padEnd(12)} HTML ${formatBytes(htmlBytes)}, modern JS ${formatBytes(jsBytes)}, ` +
      `CSS ${formatBytes(cssBytes)}, ${criticalRequests} critical requests` +
      (legacyJsBytes ? ` (${formatBytes(legacyJsBytes)} legacy noModule JS excluded)` : ''),
  );
  assertAtMost(`${route.name} HTML gzip`, htmlBytes, route.limits.html);
  assertAtMost(`${route.name} modern JS gzip`, jsBytes, route.limits.js);
  assertAtMost(`${route.name} CSS gzip`, cssBytes, route.limits.css);
  if (criticalRequests > route.limits.requests) {
    fail(`${route.name} critical requests: ${criticalRequests} exceeds ${route.limits.requests}`);
  }

  if (route.imagePreloads) {
    let preloadBytes = 0;
    for (const tag of imagePreloadTags) {
      const candidates = [attribute(tag, 'href')];
      const srcSet = attribute(tag, 'imagesrcset');
      if (srcSet) {
        candidates.push(...srcSet.split(',').map((candidate) => candidate.trim().split(/\s+/, 1)[0]));
      }
      const sizes = candidates
        .filter(Boolean)
        .map((url) => requiredOutputAsset(url, `${route.name} image preload`))
        .filter(Boolean)
        .map((file) => statSync(file).size);
      preloadBytes += sizes.length > 0 ? Math.max(...sizes) : 0;
    }
    console.log(`  image preloads: ${imagePreloadTags.length}, up to ${formatBytes(preloadBytes)} transferred`);
    if (imagePreloadTags.length > route.imagePreloads.count) {
      fail(`${route.name} image preloads: ${imagePreloadTags.length} exceeds ${route.imagePreloads.count}`);
    }
    assertAtMost(`${route.name} image preload bytes`, preloadBytes, route.imagePreloads.bytes);
  }
}

function countSearchRecords(index) {
  if (Array.isArray(index)) return index.length;
  if (Array.isArray(index?.internalDocumentIDStore?.internalIdToId)) {
    return index.internalDocumentIDStore.internalIdToId.length;
  }
  if (Number.isInteger(index?.docs?.count)) return index.docs.count;
  if (index?.docs?.docs && typeof index.docs.docs === 'object') return Object.keys(index.docs.docs).length;
  return undefined;
}

function analyzeSearch() {
  const file = path.join(outputRoot, 'static.json');
  if (!existsSync(file)) {
    fail('search: missing static.json');
    return;
  }
  const raw = readFileSync(file);
  const gzip = gzipSync(raw, { level: 9 }).byteLength;
  const index = JSON.parse(raw);
  const records = countSearchRecords(index);
  const documentCount = Number.isInteger(index?.docs?.count) ? index.docs.count : undefined;
  console.log(
    `search       ${formatBytes(raw.byteLength)} raw, ${formatBytes(gzip)} gzip, ` +
      `${records === undefined ? 'unknown' : records.toLocaleString()} records`,
  );
  assertAtMost('search raw', raw.byteLength, SEARCH_LIMITS.raw);
  assertAtMost('search gzip', gzip, SEARCH_LIMITS.gzip);
  if (records === undefined || records < 1) {
    fail('search records: unrecognized or empty search-index shape');
  } else if (records > SEARCH_LIMITS.records) {
    fail(`search records: ${records.toLocaleString()} exceeds ${SEARCH_LIMITS.records.toLocaleString()}`);
  }
  const internalCount = index?.internalDocumentIDStore?.internalIdToId?.length;
  if (Number.isInteger(internalCount) && documentCount !== undefined && internalCount !== documentCount) {
    fail(`search records disagree: id store has ${internalCount}, docs store has ${documentCount}`);
  }
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, files);
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

function analyzeOutput() {
  const files = walk(outputRoot);
  const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  let duplicateRscBytes = 0;
  let duplicatePairs = 0;

  for (const fullFile of files) {
    if (path.basename(fullFile) !== 'index.txt') continue;
    const sibling = path.join(path.dirname(fullFile), '__next._full.txt');
    if (!existsSync(sibling)) continue;
    const left = readFileSync(fullFile);
    const right = readFileSync(sibling);
    if (left.equals(right)) {
      duplicatePairs += 1;
      duplicateRscBytes += Math.min(left.byteLength, right.byteLength);
    }
  }

  console.log(`export       ${formatBytes(totalBytes)} across ${files.length.toLocaleString()} files`);
  console.log(`  duplicate sibling RSC payloads: ${duplicatePairs} pairs, ${formatBytes(duplicateRscBytes)}`);
  assertAtMost('export bytes', totalBytes, OUTPUT_LIMITS.bytes);
  if (files.length > OUTPUT_LIMITS.files) fail(`export files: ${files.length.toLocaleString()} exceeds ${OUTPUT_LIMITS.files.toLocaleString()}`);
  assertAtMost('duplicate sibling RSC bytes', duplicateRscBytes, OUTPUT_LIMITS.duplicateRscBytes);
}

function analyzeDeferredDemo() {
  const manifestFile = path.join(projectRoot, '.next/react-loadable-manifest.json');
  if (!existsSync(manifestFile)) {
    fail('deferred demo: missing React loadable manifest');
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const entry = Object.entries(manifest).find(([key]) => key.includes('SkillGraphTryItInner'))?.[1];
  if (!entry?.files) {
    fail('deferred demo: SkillGraphTryItInner is not listed in the React loadable manifest');
    return;
  }
  const files = [...new Set(entry.files.map((file) => path.join(outputRoot, '_next', file)))];
  for (const file of files) {
    if (!existsSync(file)) fail(`deferred demo: manifest asset is missing: ${path.relative(outputRoot, file)}`);
  }
  const existingFiles = files.filter((file) => existsSync(file));
  const bytes = existingFiles.reduce((sum, file) => sum + gzipFile(file), 0);
  const initialSkillsAssets = routeInitialAssets.get('skills guide') ?? new Set();
  const eagerFiles = existingFiles.filter((file) => initialSkillsAssets.has(file));
  console.log(`deferred demo ${formatBytes(bytes)} gzip across ${existingFiles.length} async assets`);
  if (eagerFiles.length > 0) {
    fail(`deferred demo: ${eagerFiles.length} async assets also appear in the skills page's initial tags`);
  }
  assertAtMost('deferred demo async payload', bytes, DEMO_ASYNC_GZIP_LIMIT);
}

if (!existsSync(outputRoot)) {
  console.error(`Static export not found: ${outputRoot}`);
  process.exit(1);
}

console.log(`Checking static-site budgets in ${outputRoot}`);
for (const route of ROUTES) analyzeRoute(route);
analyzeSearch();
analyzeOutput();
analyzeDeferredDemo();

if (failures.length > 0) {
  console.error(`\nSite budget failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}.`);
  process.exit(1);
}

console.log('\nSite budget passed.');
