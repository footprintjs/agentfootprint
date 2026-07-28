#!/usr/bin/env node
/**
 * Record the EXERCISED column for the docs-truth check, from real runs.
 *
 * Runs every example under `examples/*` end-to-end and records what actually
 * happened, then writes the evidence to docs/docs-truth/exercised.json for
 * `scripts/docs-truth-check.mjs` to consume.
 *
 * ── ZERO CREDENTIALS, BY CONSTRUCTION ──────────────────────────────────
 * Every example defaults to `MockProvider` (examples/helpers/provider.ts), so
 * the suite runs offline. This script additionally STRIPS anything credential-
 * shaped from each child process's environment by NAME — it never reads, logs
 * or forwards a value. If a key is present in the parent shell it is removed,
 * not used, so the recording is identical on a laptop and in CI. `--audit-env`
 * prints the removed NAMES only.
 *
 * ── THE TWO SIGNALS, AND WHAT THEY ARE WORTH ───────────────────────────
 *  1. events observed (runtime, strong)
 *     Every event that reached the event bus, captured by
 *     scripts/docs-truth-instrument.mjs with the listener gates forced open.
 *     This is behaviour, not inference. Its limit: an event emitted only via a
 *     recorder no example ever attaches is not seen — reported UNKNOWN, never
 *     "absent".
 *  2. symbols referenced (static, weaker — and named as such)
 *     The named imports of every example that EXITED ZERO. A symbol imported by
 *     a green run is "exercised". This OVER-counts: an import on a branch never
 *     taken still counts. It over-counts in the safe direction for the doc-gap
 *     numbers (it can only shrink the "undocumented" list, never inflate it)
 *     and in the unsafe direction for "possibly dead", which the report says.
 *     Imports from a FAILED example are discarded entirely.
 *
 * Also recorded, because it is worth knowing: examples that reach past the
 * public export map into deep `src/` internals. Those imports prove nothing
 * about the published surface.
 *
 * Usage:
 *   node scripts/docs-truth-exercise.mjs                # record
 *   node scripts/docs-truth-exercise.mjs --concurrency 4
 *   node scripts/docs-truth-exercise.mjs --audit-env     # show stripped NAMES
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = join(ROOT, 'docs', 'docs-truth');
const OUT_PATH = join(DATA_DIR, 'exercised.json');
const INSTRUMENT = join(__dirname, 'docs-truth-instrument.mjs');

const argv = process.argv.slice(2);
const AUDIT_ENV = argv.includes('--audit-env');
const CONCURRENCY = argv.includes('--concurrency')
  ? Math.max(1, Number(argv[argv.indexOf('--concurrency') + 1]) || 4)
  : 4;
const TIMEOUT_MS = 120_000;

// ─────────────────────────────────────────────────────────────────────
// Credential hygiene — strip by NAME, never read a value
// ─────────────────────────────────────────────────────────────────────

const CREDENTIAL_NAME =
  /(^|_)(KEY|KEYS|TOKEN|SECRET|SECRETS|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|SESSION|AUTH)($|_)/i;
const CREDENTIAL_PREFIX =
  /^(AWS_|ANTHROPIC_|OPENAI_|AZURE_|GOOGLE_|GEMINI_|HF_|HUGGING|COHERE_|MISTRAL_|GROQ_|OLLAMA_|BEDROCK_|GH_|GITHUB_|NPM_|CODECOV_)/i;

function sanitizedEnv() {
  const stripped = [];
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (CREDENTIAL_NAME.test(name) || CREDENTIAL_PREFIX.test(name)) {
      stripped.push(name); // NAME only — the value is never touched again
      continue;
    }
    env[name] = value;
  }
  return { env, stripped: stripped.sort() };
}

const { env: BASE_ENV, stripped: STRIPPED_NAMES } = sanitizedEnv();

if (AUDIT_ENV) {
  console.log('Environment variables removed from every example child process (NAMES only,');
  console.log('values are never read, logged or forwarded):');
  console.log('');
  if (STRIPPED_NAMES.length === 0) console.log('  (none present in this shell)');
  else for (const n of STRIPPED_NAMES) console.log(`  ${n}`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────
// Discover examples — the same glob scripts/run-all-examples.sh uses
// ─────────────────────────────────────────────────────────────────────

function findExamples() {
  const base = join(ROOT, 'examples');
  const out = [];
  for (const dir of readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
    for (const file of readdirSync(join(base, dir.name))) {
      if (file.endsWith('.ts') && !file.endsWith('.d.ts')) out.push(join(base, dir.name, file));
    }
  }
  return out.sort();
}

// ─────────────────────────────────────────────────────────────────────
// Static import scan
// ─────────────────────────────────────────────────────────────────────

/** src-relative module path → the public subpath that ships it, if any. */
const SRC_TO_SUBPATH = (() => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const map = new Map();
  for (const [subpath, value] of Object.entries(pkg.exports ?? {})) {
    if (typeof value !== 'object' || !value) continue;
    const dts = value?.require?.types;
    if (!dts) continue;
    // dist/types/observe.d.ts → src/observe.ts ; dist/types/memory/index.d.ts → src/memory/index.ts
    const srcish = dts.replace(/^\.\/dist\/types\//, '').replace(/\.d\.ts$/, '');
    map.set(`src/${srcish}`, subpath);
  }
  return map;
})();

function scanImports(file) {
  const text = readFileSync(file, 'utf8');
  const names = new Set();
  const publicSubpaths = new Set();
  const internalPaths = new Set();

  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) {
    const spec = m[2];
    let normalized = null;
    if (spec.startsWith('agentfootprint')) {
      normalized = spec === 'agentfootprint' ? '.' : `.${spec.slice('agentfootprint'.length)}`;
    } else if (/^(\.\.\/)+src\//.test(spec)) {
      const bare = 'src/' + spec.replace(/^(\.\.\/)+src\//, '').replace(/\.js$/, '');
      normalized = SRC_TO_SUBPATH.get(bare) ?? SRC_TO_SUBPATH.get(`${bare}/index`) ?? null;
      if (!normalized) internalPaths.add(bare);
    } else {
      continue; // footprintjs, node builtins, helpers — not our surface
    }
    if (normalized) publicSubpaths.add(normalized);
    for (const raw of m[1].split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
    }
  }
  return {
    names: [...names],
    publicSubpaths: [...publicSubpaths],
    internalPaths: [...internalPaths],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Run one example under the event tap
// ─────────────────────────────────────────────────────────────────────

const SCRATCH = join(tmpdir(), `af-docs-truth-${process.pid}`);
mkdirSync(SCRATCH, { recursive: true });

function runExample(file, index) {
  return new Promise((done) => {
    const eventsFile = join(SCRATCH, `events-${index}.log`);
    writeFileSync(eventsFile, '');
    const started = Date.now();
    const child = spawn('npx', ['--yes', 'tsx', '--import', INSTRUMENT, relative(ROOT, file)], {
      cwd: ROOT,
      env: {
        ...BASE_ENV,
        TSX_TSCONFIG_PATH: 'examples/runtime.tsconfig.json',
        AF_DOCS_TRUTH_ROOT: ROOT,
        AF_DOCS_TRUTH_EVENTS: eventsFile,
        CI: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => {
      if (stderr.length < 4000) stderr += String(c);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = existsSync(eventsFile)
        ? readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean)
        : [];
      const tapFailure = lines.find((l) => l.startsWith('__TAP_FAILED__')) ?? null;
      done({
        file: relative(ROOT, file),
        ok: code === 0,
        exitCode: code,
        durationMs: Date.now() - started,
        events: [...new Set(lines.filter((l) => !l.startsWith('__')))].sort(),
        tapFailure,
        stderrTail: code === 0 ? null : stderr.split('\n').slice(-6).join('\n').trim() || null,
      });
    });
  });
}

async function main() {
  const files = findExamples();
  console.log(`docs-truth: recording reference runs from ${files.length} example scripts`);
  console.log(
    `            zero credentials — ${STRIPPED_NAMES.length} credential-shaped env var(s)`,
  );
  console.log(`            removed by name from every child (see --audit-env for the names)`);
  console.log(`            concurrency ${CONCURRENCY}`);
  console.log('');

  const results = new Array(files.length);
  let next = 0;
  let finished = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await runExample(files[i], i);
      finished++;
      const r = results[i];
      process.stdout.write(
        `[${String(finished).padStart(3)}/${files.length}] ${r.ok ? 'ok  ' : 'FAIL'} ${r.file}${
          r.tapFailure ? ' (event tap failed!)' : ''
        }\n`,
      );
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const tapFailures = results.filter((r) => r.tapFailure);

  const eventsObserved = new Set();
  for (const r of results) for (const ev of r.events) eventsObserved.add(ev);

  // Only GREEN runs contribute symbol evidence.
  const symbolsReferenced = new Set();
  const subpathsReferenced = new Set();
  const internalPaths = new Set();
  for (const r of passed) {
    const scan = scanImports(join(ROOT, r.file));
    for (const n of scan.names) symbolsReferenced.add(n);
    for (const sp of scan.publicSubpaths) subpathsReferenced.add(sp);
    for (const p of scan.internalPaths) internalPaths.add(p);
  }

  const payload = {
    $schema: 'docs-truth exercised-evidence v1',
    note:
      'Recorded by `npm run docs:truth:exercise`. Ran every examples/*/*.ts with zero ' +
      'credentials. eventsObserved is RUNTIME evidence (event bus, listener gates forced ' +
      'open). symbolsReferenced is STATIC: named imports of examples that exited 0 — it ' +
      'over-counts, so treat it as a floor for doc gaps and read "never exercised" with care.',
    recordedAt: new Date().toISOString().slice(0, 10),
    node: process.version,
    credentialsUsed: false,
    envVarsStrippedByName: STRIPPED_NAMES.length,
    totals: {
      total: results.length,
      passed: passed.length,
      failed: failed.length,
      eventTapFailures: tapFailures.length,
    },
    failedExamples: failed.map((r) => ({
      file: r.file,
      exitCode: r.exitCode,
      stderrTail: r.stderrTail,
    })),
    eventsObserved: [...eventsObserved].sort(),
    subpathsReferenced: [...subpathsReferenced].sort(),
    symbolsReferenced: [...symbolsReferenced].sort(),
    examplesImportingSrcInternals: [...internalPaths].sort(),
    perExample: results.map((r) => ({
      file: r.file,
      ok: r.ok,
      durationMs: r.durationMs,
      eventCount: r.events.length,
    })),
  };

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  rmSync(SCRATCH, { recursive: true, force: true });

  console.log('');
  console.log(`${passed.length}/${results.length} examples green with zero credentials`);
  console.log(`${eventsObserved.size} distinct event types observed firing`);
  console.log(`${symbolsReferenced.size} exported symbols referenced by a green example`);
  if (internalPaths.size > 0) {
    console.log(
      `${internalPaths.size} deep src/ path(s) imported by examples that the export map does not publish`,
    );
  }
  if (tapFailures.length > 0) {
    console.log(
      `WARNING: the event tap failed in ${tapFailures.length} run(s) — events undercounted`,
    );
    for (const r of tapFailures.slice(0, 3)) console.log(`  ${r.file}: ${r.tapFailure}`);
  }
  for (const r of failed.slice(0, 10)) console.log(`FAILED ${r.file} (exit ${r.exitCode})`);
  console.log('');
  console.log(`evidence written → ${relative(ROOT, OUT_PATH)}`);
  console.log('Next: npm run docs:truth  (or npm run docs:truth:baseline to re-record)');
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
