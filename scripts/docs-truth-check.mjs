#!/usr/bin/env node
/**
 * DOCS-TRUTH CHECK — "do my docs describe what my code actually does?"
 *
 * Answers three SEPARATE questions for every capability the package exposes,
 * because their combinations are different bugs:
 *
 *   1. DECLARED   — is it in the published public surface?
 *   2. DOCUMENTED — does the published docs tree describe it in prose?
 *   3. EXERCISED  — does a real reference run produce/exercise it?
 *
 * ── DECLARED (how, and why not TypeDoc) ────────────────────────────────
 * TypeDoc runs from a SINGLE entry point (typedoc.json → `src/index.ts`), so it
 * sees the root barrel and nothing else — every `agentfootprint/<subpath>`
 * symbol is invisible to it. This script instead reads package.json
 * `"exports"`, resolves each subpath to its SHIPPED `.d.ts` under `dist/`, and
 * enumerates the exported symbols with the TypeScript checker (so `export *`
 * re-export chains resolve exactly as a consumer's compiler sees them).
 * Requires `npm run build` first — the surface is what SHIPS, not what's in src.
 *
 * Events are enumerated from `src/events/registry.ts` (`ALL_EVENT_TYPES`),
 * which is authoritative; its count is pinned by
 * test/events/unit/registry.test.ts.
 *
 * ── DOCUMENTED: the folder policy (this is the part that can silently lie) ──
 * The repo has FOUR docs locations and they are NOT equivalent:
 *
 *   1. docs-next/content/docs/ **.mdx  (hand-written)  → THE TRUTH SOURCE.
 *      This is what the published site renders and what a reader sees.
 *   2. docs-next/content/docs/api/**   (TypeDoc-generated) → EXCLUDED.
 *   3. docs/api-reference/**           (TypeDoc-generated) → EXCLUDED.
 *   4. docs/**.md + README.md          (repo-internal prose) → NOT documented,
 *      but tracked as its own state ("written, not published").
 *
 * (2) and (3) MUST be excluded because they are generated FROM THE SOURCE:
 * every exported symbol appears in them BY CONSTRUCTION. Counting either would
 * mark everything "documented", make every gap vanish, and hand back a clean
 * bill of health that means nothing — false reassurance, which is worse than no
 * check at all. The report prints how many symbols would have flipped, so the
 * size of that trap is visible rather than asserted.
 *
 * So DOCUMENTED is four-valued:
 *   site-prose      — the name appears in PROSE (anywhere outside a fenced code
 *                     block: headings, paragraphs, table cells, inline `code`
 *                     spans, frontmatter title/description) on a hand-written
 *                     page under docs-next/content/docs. This alone counts as
 *                     documented.
 *   site-code-only  — appears ONLY inside a fenced code sample on those pages.
 *                     A reader scanning the page never learns it exists.
 *   repo-only       — absent from the site, but explained in prose somewhere in
 *                     the repo (docs/**, README.md). A cheaper problem: the
 *                     prose exists and needs PUBLISHING, not authoring.
 *   absent          — nobody has written about it anywhere.
 *
 * ── EXERCISED ──────────────────────────────────────────────────────────
 * Read from committed evidence (docs/docs-truth/exercised.json) recorded by
 * `npm run docs:truth:exercise`, which runs the repo's own examples/ with ZERO
 * credentials. Anything the evidence cannot speak to is UNKNOWN, never
 * "absent". See that script's header for the exact signals.
 *
 * ── POLICY: RATCHET, NOT GATE ──────────────────────────────────────────
 * The repo has pre-existing gaps. Failing CI on the current state would go red
 * immediately and be disabled within a day, so this is a ratchet:
 *   • docs/docs-truth/baseline.json records today's known gaps.
 *   • CI fails only when the situation gets WORSE than baseline.
 *   • "docs promise something that does not exist" fails ALWAYS, baseline or
 *     not — that class actively misleads readers; there should be zero.
 *   • Fixed a gap? `npm run docs:truth:baseline` re-records and regenerates
 *     docs/DOCS_TRUTH_REPORT.md.
 *
 * Usage:
 *   node scripts/docs-truth-check.mjs                     # check (read-only)
 *   node scripts/docs-truth-check.mjs --json out.json
 *   node scripts/docs-truth-check.mjs --update-baseline    # re-baseline + report
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nodeModule from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = nodeModule.createRequire(join(ROOT, 'package.json'));
const ts = require('typescript');

/** (1) The published, hand-written site docs — the only DOCUMENTED source. */
const SITE_DOCS = join(ROOT, 'docs-next', 'content', 'docs');
/** (2) TypeDoc output inside the site tree — excluded from DOCUMENTED. */
const GENERATED_IN_SITE = join(SITE_DOCS, 'api');
/** (3) The other TypeDoc output — excluded from DOCUMENTED. */
const GENERATED_LEGACY = join(ROOT, 'docs', 'api-reference');
/** (4) Repo-internal prose. Not documented; its own state. */
const REPO_PROSE_ROOTS = [join(ROOT, 'docs'), join(ROOT, 'README.md')];

const DATA_DIR = join(ROOT, 'docs', 'docs-truth');
const BASELINE_PATH = join(DATA_DIR, 'baseline.json');
const EXERCISED_PATH = join(DATA_DIR, 'exercised.json');
const REPORT_PATH = join(ROOT, 'docs', 'DOCS_TRUTH_REPORT.md');

const argv = process.argv.slice(2);
const UPDATE_BASELINE = argv.includes('--update-baseline');
const JSON_OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;

// ─────────────────────────────────────────────────────────────────────
// 1. DECLARED — the real published surface, per package.json subpath
// ─────────────────────────────────────────────────────────────────────

function readExportMap() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const out = [];
  for (const [subpath, value] of Object.entries(pkg.exports ?? {})) {
    if (typeof value === 'string') continue; // e.g. "./package.json"
    const dts = value?.require?.types ?? value?.import?.types;
    if (!dts) continue;
    out.push({ subpath, dts: resolve(ROOT, dts) });
  }
  return out;
}

const KIND_ORDER = ['function', 'class', 'const', 'enum', 'interface', 'type', 'other'];

function symbolKind(sym, checker) {
  let s = sym;
  if (s.flags & ts.SymbolFlags.Alias) {
    try {
      s = checker.getAliasedSymbol(s);
    } catch {
      /* keep the alias */
    }
  }
  const f = s.flags;
  if (f & ts.SymbolFlags.Class) return 'class';
  if (f & (ts.SymbolFlags.Function | ts.SymbolFlags.Method)) return 'function';
  if (f & ts.SymbolFlags.Interface) return 'interface';
  if (f & ts.SymbolFlags.TypeAlias) return 'type';
  if (f & ts.SymbolFlags.Enum) return 'enum';
  if (
    f &
    (ts.SymbolFlags.Variable | ts.SymbolFlags.BlockScopedVariable | ts.SymbolFlags.Property)
  ) {
    // `export const foo = (…) => …` is a function to a reader.
    try {
      const decl = s.valueDeclaration ?? s.declarations?.[0];
      const t = decl ? checker.getTypeOfSymbolAtLocation(s, decl) : null;
      if (t && checker.getSignaturesOfType(t, ts.SignatureKind.Call).length > 0) return 'function';
    } catch {
      /* fall through */
    }
    return 'const';
  }
  return 'other';
}

function buildSurface() {
  const entries = readExportMap();
  const missing = entries.filter((e) => !existsSync(e.dts));
  if (missing.length > 0) {
    console.error('docs-truth: the shipped type declarations are missing:');
    for (const m of missing) console.error(`  ${m.subpath} → ${relative(ROOT, m.dts)}`);
    console.error('\nThe DECLARED column reads what SHIPS. Run `npm run build` first.');
    process.exit(2);
  }

  const program = ts.createProgram(
    entries.map((e) => e.dts),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      skipLibCheck: true,
    },
  );
  const checker = program.getTypeChecker();

  const symbols = new Map(); // name → { name, kind, subpaths[] }
  const perSubpath = new Map();

  for (const entry of entries) {
    const sf = program.getSourceFile(entry.dts);
    if (!sf) {
      console.error(`docs-truth: could not load ${relative(ROOT, entry.dts)}`);
      process.exit(2);
    }
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    const names = [];
    for (const sym of exported) {
      const name = sym.getName();
      if (name === 'default' || name.startsWith('__')) continue;
      names.push(name);
      const existing = symbols.get(name);
      if (existing) existing.subpaths.push(entry.subpath);
      else symbols.set(name, { name, kind: symbolKind(sym, checker), subpaths: [entry.subpath] });
    }
    perSubpath.set(entry.subpath, names.sort());
  }

  return { symbols, perSubpath, subpaths: entries.map((e) => e.subpath) };
}

// ─────────────────────────────────────────────────────────────────────
// 1b. DECLARED events — src/events/registry.ts is authoritative
// ─────────────────────────────────────────────────────────────────────

function readDeclaredEvents() {
  const file = join(ROOT, 'src', 'events', 'registry.ts');
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  let names = null;
  let line = 0;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'ALL_EVENT_TYPES'
    ) {
      let init = node.initializer;
      while (init && ts.isAsExpression(init)) init = init.expression;
      if (init && ts.isArrayLiteralExpression(init)) {
        names = init.elements.filter((el) => ts.isStringLiteral(el)).map((el) => el.text);
        line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!names || names.length === 0) {
    console.error('docs-truth: could not read ALL_EVENT_TYPES from src/events/registry.ts');
    process.exit(2);
  }
  return { names, source: `src/events/registry.ts:${line}` };
}

// ─────────────────────────────────────────────────────────────────────
// 2. DOCUMENTED — site prose / site code sample / repo prose / absent
// ─────────────────────────────────────────────────────────────────────

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
/**
 * `agentfootprint.<domain>.<action>`.
 *
 * The trailing guard rejects the whole match rather than letting the greedy
 * `[a-z_]+` backtrack into a shorter, wrong one: prose says
 * `agentfootprint.stream.tool_*` (a legitimate wildcard subscription), and
 * without `_` in the guard that yields the phantom event
 * `agentfootprint.stream.tool`.
 */
const EVENT_RE = /agentfootprint\.[a-z_]+\.[a-z_]+(?![a-z_*])/g;
/** A module specifier must be QUOTED to count as one — bare prose text like a
 *  GitHub URL or a CloudWatch log-group path is not a promise about imports. */
const SPECIFIER_RE = /(['"`])(agentfootprint(?:\/[A-Za-z0-9._/-]+)?)\1/g;
/** Specifier shapes that are plainly a URL fragment, not an import path. */
const URLISH_RE = /(^|\/)(blob|tree|issues|pull|releases|main)(\/|$)/;

function walkFiles(dir, exts, skipDirs, out = []) {
  if (!existsSync(dir)) return out;
  if (statSync(dir).isFile()) {
    if (exts.some((x) => dir.endsWith(x))) out.push(dir);
    return out;
  }
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (skipDirs.some((skip) => full === skip)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, exts, skipDirs, out);
    else if (exts.some((x) => name.endsWith(x))) out.push(full);
  }
  return out;
}

/**
 * Fenced blocks are code; everything else on the page is prose.
 *
 * Done line by line on purpose. A single regex for fenced blocks is easy to get
 * subtly wrong — an `$` under the `m` flag terminates at the first line break,
 * which silently leaks whole code bodies into "prose" and inflates the
 * documented count. Tracking the open fence explicitly cannot make that mistake.
 */
function splitProseAndCode(raw) {
  const lines = raw.replace(/<!--[\s\S]*?-->/g, ' ').split('\n');
  const prose = [];
  const code = [];
  let openFence = null; // the exact marker that opened the current block
  let openInfo = null; // its info string, e.g. "ts twoslash"
  // How many code blocks the docs build's twoslash gate actually compiles.
  const fences = { twoslash: 0, ungatedCode: 0, other: 0, packageImportsUngated: 0 };
  for (const line of lines) {
    const opener = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    const marker = opener?.[1] ?? null;
    if (openFence === null) {
      if (marker) {
        openFence = marker;
        openInfo = (opener[2] ?? '').trim();
        if (/twoslash/.test(openInfo)) fences.twoslash++;
        else if (/^(ts|typescript|tsx|js|javascript|jsx)\b/.test(openInfo)) fences.ungatedCode++;
        else fences.other++;
        code.push(line);
      } else {
        prose.push(line);
      }
    } else {
      code.push(line);
      // A closing fence uses the same character and is at least as long.
      if (marker && marker[0] === openFence[0] && marker.length >= openFence.length) {
        openFence = null;
        openInfo = null;
      } else if (!/twoslash/.test(openInfo ?? '') && /from '(agentfootprint)/.test(line)) {
        fences.packageImportsUngated++;
      }
    }
  }
  return { prose: prose.join('\n'), code: code.join('\n'), fences };
}

function tokensOf(text) {
  const set = new Set();
  for (const m of text.matchAll(IDENT_RE)) set.add(m[0]);
  return set;
}

function buildDocIndex() {
  if (!existsSync(SITE_DOCS)) {
    console.error(`docs-truth: site docs tree not found at ${relative(ROOT, SITE_DOCS)}`);
    process.exit(2);
  }

  // (1) hand-written site pages — the truth source.
  const sitePages = walkFiles(SITE_DOCS, ['.mdx', '.md'], [GENERATED_IN_SITE]).sort();
  // (2) + (3) generated trees — enumerated ONLY to quantify the trap they pose.
  const generatedInSite = walkFiles(GENERATED_IN_SITE, ['.md', '.mdx'], []).sort();
  const generatedLegacy = walkFiles(GENERATED_LEGACY, ['.md'], []).sort();
  // (4) repo-internal prose.
  const repoPages = REPO_PROSE_ROOTS.flatMap((r) =>
    walkFiles(r, ['.md'], [GENERATED_LEGACY, DATA_DIR, REPORT_PATH]),
  ).sort();

  const siteProse = new Map(); // token → Set<page>
  const siteCode = new Map();
  const repoProse = new Map();
  const eventMentions = new Map(); // event → { siteProse, siteCode, repoProse }
  const importUses = []; // { file, spec, names[] }
  const subpathMentions = new Map();

  const addTo = (map, token, page) => {
    let s = map.get(token);
    if (!s) map.set(token, (s = new Set()));
    s.add(page);
  };
  const eventBucket = (name) => {
    let rec = eventMentions.get(name);
    if (!rec)
      eventMentions.set(
        name,
        (rec = { siteProse: new Set(), siteCode: new Set(), repoProse: new Set() }),
      );
    return rec;
  };

  const fenceTotals = { twoslash: 0, ungatedCode: 0, other: 0, packageImportsUngated: 0 };

  for (const f of sitePages) {
    const page = relative(ROOT, f);
    const raw = readFileSync(f, 'utf8');
    const { prose, code, fences } = splitProseAndCode(raw);
    for (const k of Object.keys(fenceTotals)) fenceTotals[k] += fences[k];
    for (const t of tokensOf(prose)) addTo(siteProse, t, page);
    for (const t of tokensOf(code)) addTo(siteCode, t, page);
    for (const m of prose.matchAll(EVENT_RE)) eventBucket(m[0]).siteProse.add(page);
    for (const m of code.matchAll(EVENT_RE)) eventBucket(m[0]).siteCode.add(page);

    // Every module specifier the site points a reader at, in quoted form.
    for (const m of raw.matchAll(SPECIFIER_RE)) {
      if (m[2] === 'agentfootprint') continue; // the bare package name is everywhere
      if (URLISH_RE.test(m[2].slice('agentfootprint'.length))) continue; // a URL, not an import
      addTo(subpathMentions, m[2], page);
    }
    // Named imports — the highest-signal "the docs promise this exists"
    // statement, because a reader copy-pastes it verbatim.
    const importRe =
      /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](agentfootprint(?:\/[A-Za-z0-9._/-]+)?)['"]/g;
    for (const m of raw.matchAll(importRe)) {
      const names = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) =>
          s
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0]
            .trim(),
        )
        .filter((s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s));
      if (names.length > 0) importUses.push({ file: page, spec: m[2], names });
    }
  }

  for (const f of repoPages) {
    const page = relative(ROOT, f);
    const { prose } = splitProseAndCode(readFileSync(f, 'utf8'));
    for (const t of tokensOf(prose)) addTo(repoProse, t, page);
    for (const m of prose.matchAll(EVENT_RE)) eventBucket(m[0]).repoProse.add(page);
  }

  // Which `agentfootprint.*.*` event literals does src actually EMIT? This is
  // what separates "the docs describe a ghost" from "the docs are right and the
  // typed registry is missing an entry" — two very different bugs.
  const emittedEventLiterals = new Map(); // event → "file:line" of the emit call
  for (const f of walkFiles(join(ROOT, 'src'), ['.ts'], [])) {
    const text = readFileSync(f, 'utf8');
    if (!text.includes('agentfootprint.')) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (!/\b(emit|dispatch|\$emit|typedEmit)\s*\(/.test(line)) return;
      for (const m of line.matchAll(EVENT_RE)) {
        if (!emittedEventLiterals.has(m[0])) {
          emittedEventLiterals.set(m[0], `${relative(ROOT, f)}:${i + 1}`);
        }
      }
    });
  }

  // Generated trees: one file per exported symbol. Counted ONLY to measure the
  // trap — never as documentation.
  const generatedSymbols = new Set();
  for (const f of [...generatedInSite, ...generatedLegacy]) {
    const name = basename(f).replace(/\.mdx?$/, '');
    if (name === 'index' || name === 'meta' || name === 'README') continue;
    generatedSymbols.add(name);
  }

  return {
    sitePageCount: sitePages.length,
    repoPageCount: repoPages.length,
    generatedInSiteCount: generatedInSite.length,
    generatedLegacyCount: generatedLegacy.length,
    siteProse,
    siteCode,
    repoProse,
    generatedSymbols,
    emittedEventLiterals,
    fenceTotals,
    eventMentions,
    importUses,
    subpathMentions,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 3. EXERCISED — committed evidence from real, credential-free runs
// ─────────────────────────────────────────────────────────────────────

function readExercised() {
  if (!existsSync(EXERCISED_PATH)) return null;
  try {
    return JSON.parse(readFileSync(EXERCISED_PATH, 'utf8'));
  } catch (err) {
    console.error(`docs-truth: could not parse ${relative(ROOT, EXERCISED_PATH)}: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3c. DOC-TEXT RULES — prose that contradicts the code it sits next to
// ─────────────────────────────────────────────────────────────────────
/**
 * Everything above this line reasons about NAMES: is the symbol exported, is
 * its name mentioned in prose, was it seen firing. Nothing above reads a
 * SENTENCE. Three defects shipped in 8.10.0 that were nothing BUT sentences —
 * every symbol involved existed, was exported, and was documented, so every
 * check in this file passed while the words were wrong:
 *
 *   1. six doc lines in `src/strategies/types.ts` called the observability
 *      hot path `onEvent`; it is `exportEvent`, and the wrong name SHIPS —
 *      doc comments are copied verbatim into the emitted `.d.ts`, so it is
 *      what a consumer's editor shows on hover.
 *   2. `DefineSkillOptions.tools` said its tools are "added to the tools slot
 *      once activated". They are not: they go into the registry at BUILD time
 *      and are callable from iteration 1 unless `autoActivate` is set. A
 *      reader who believed it shipped tools they thought were hidden.
 *   3. `autoActivate` called itself "a forward-compat marker" awaiting "v2.5
 *      runtime wiring" — six majors after that wiring shipped.
 *
 * Nothing mechanical could have caught any of them. TypeDoc renders a comment,
 * it never disagrees with one; twoslash compiles fenced code, and a comment is
 * not code. So this section is a small set of TARGETED greps — one per known
 * defect, each naming an exact file, an exact wrong phrase and the exact fix.
 *
 * POLICY: GATE, not ratchet. Unlike the undocumented-symbol counts, whose
 * steady state is "hundreds of known gaps", the steady state of each rule here
 * is ZERO by construction: a rule is only added once the sentence it describes
 * has been established as false. There is nothing to ratchet, and baselining a
 * known-false sentence would mean shipping it deliberately. These findings
 * therefore fail the build like the phantom class, baseline or not, and they
 * are NOT recorded in baseline.json.
 *
 * Being greps, they are literal-minded, and that is deliberate — the moment a
 * rule needs a semantic model of the sentence it stops being trustworthy. When
 * a rule is genuinely wrong, EDIT THE RULE (they are one array, below) rather
 * than adding a suppression marker to the source: a marker in a doc comment
 * would ship inside the published `.d.ts`, which is the very surface defect 1
 * was about.
 */

/** Generated or vendored trees. Nothing here is hand-written prose. */
const SCAN_SKIP = [
  join(ROOT, 'node_modules'),
  join(ROOT, 'dist'),
  join(ROOT, '.git'),
  join(ROOT, 'coverage'),
  join(ROOT, 'docs-next', 'node_modules'),
  join(ROOT, 'docs-next', '.next'),
  GENERATED_IN_SITE, // docs-next/content/docs/api  (TypeDoc)
  GENERATED_LEGACY, // docs/api-reference           (TypeDoc)
  DATA_DIR, // docs/docs-truth              (this check's own data)
  REPORT_PATH, // docs/DOCS_TRUTH_REPORT.md    (this check's own output)
];

const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

function scanFiles(relDir, exts) {
  return walkFiles(join(ROOT, relDir), exts, SCAN_SKIP);
}

function readLines(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8').split('\n');
}

/**
 * A mention the sentence itself denies — "the hot path is `exportEvent`; there
 * is no `onEvent`" — is the CORRECTION, not the defect, and flagging it would
 * push an author into deleting a genuinely useful line.
 *
 * Deliberately narrow: the denial must be ADJACENT to the name — only quoting,
 * an article or a determiner may sit between. Measured against the six real
 * defect lines this matters: "the dispatcher never awaits a strategy's
 * `onEvent`" is a genuine wrong-name claim that a looser "negation anywhere
 * nearby" test would have excused, and did, until this was tightened.
 *
 * Used ONLY by the identifier rule, where "X is not the name" is a natural
 * thing to write. It is NOT applied to the semantic phrase rules, where the
 * negation attaches to some other word in the sentence and the exemption would
 * hide exactly the class of lie being hunted.
 */
function isDeniedMention(line, index) {
  return /\b(?:no|not|never|no longer|instead of|rather than|nothing (?:named|called))\s+(?:an?|the|any|its|his|her|their)?\s*[`'"([]*$/i.test(
    line.slice(0, index),
  );
}

/** 1-based line numbers whose text sits inside a `//` or `/* … *​/` comment. */
function commentLineNumbers(text) {
  const set = new Set();
  let inBlock = false;
  text.split('\n').forEach((line, i) => {
    const n = i + 1;
    const t = line.trim();
    if (inBlock) {
      set.add(n);
      if (t.includes('*/')) inBlock = false;
      return;
    }
    if (t.startsWith('//')) return void set.add(n);
    const open = line.indexOf('/*');
    if (open !== -1) {
      set.add(n);
      if (line.indexOf('*/', open + 2) === -1) inBlock = true;
      return;
    }
    if (line.includes('//')) set.add(n);
  });
  return set;
}

/**
 * "Near the `tools` field" means the doc comment ATTACHED to it — the block a
 * reader sees on hover and the block TypeDoc renders under that field. A plain
 * ±N-line window is wrong here: `body`'s docstring sits nine lines above
 * `tools`, and "the body is appended once activated" is TRUE, so a window
 * would fire on a correct sentence about a different field.
 */
function attachedDocLines(lines, declRe) {
  const out = new Set();
  lines.forEach((line, i) => {
    if (!declRe.test(line)) return;
    out.add(i + 1);
    for (let j = i - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (t === '') break;
      const isComment =
        t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.endsWith('*/');
      if (!isComment) break;
      out.add(j + 1);
      if (t.startsWith('/*')) break; // reached the top of the block
    }
  });
  return out;
}

const cmpVersion = (a, b) => {
  const p = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** A bare `onEvent`, not the tail of `FlowDecisionEvent`/`AgentCoreSessionEvent`. */
const BARE_ON_EVENT = /(?<![A-Za-z0-9_$])onEvent(?![A-Za-z0-9_$])/g;

/** A version a docstring points AT: `v2.5`, `v2.5.1`. The `v` is required —
 *  bare `3.5` is a model number ("Claude ≥ 3.5") far more often than a release. */
const VERSION_REF = /\bv(\d+)\.(\d+)(?:\.(\d+))?\b/g;
/** Language that puts the version in the FUTURE — the thing that goes stale. */
const PROMISE_CUE =
  /\b(?:will|would|lands?|landing|arrives?|ships?|shipping|awaits?|awaiting|pending|planned|slated|upcoming|coming|scheduled|future|when|once|until|reserved|forward[- ]compat\w*|todo|joins?|implements?|wiring|not yet|yet to)\b/i;
/** Language that puts it in the PAST — a historical note, which never rots. */
const HISTORY_CUE =
  /\b(?:since|as of|released|shipped in|added in|introduced|removed|deprecated|renamed|fixed in|changed in|behaviou?r)\b/i;

/**
 * The rules. Each `find()` returns findings:
 *   { file, line, text, detail }        — `text` is the offending line, trimmed.
 * `precondition(surface)` may DISARM a rule against the real export map, so a
 * rule cannot outlive the fact it encodes.
 */
const DOC_TEXT_RULES = [
  {
    id: 'strategy-hot-path-name',
    headline: 'a strategy doc comment calls the hot path `onEvent`',
    why:
      'The ObservabilityStrategy hot path is `exportEvent`. `onEvent` is not a method on any ' +
      'strategy interface, and doc comments are copied verbatim into the emitted .d.ts — so the ' +
      'wrong name ships and is what a consumer sees on hover.',
    fix: 'Rename the mention to `exportEvent` (or the right per-group name: `recordCost`, `renderStatus`, `renderGraph`).',
    // AUDIT (8.11.0): `grep -REn '\bonEvent\b' src/` finds no declaration,
    // no call site and no string literal — every hit was doc prose. So the
    // bare identifier is flagged ANYWHERE under src/strategies/, not just in
    // comments. If a legitimately-named `onEvent` member is ever introduced,
    // narrow this to comment lines with `commentLineNumbers()` rather than
    // deleting the rule.
    find() {
      const out = [];
      for (const abs of scanFiles('src/strategies', ['.ts'])) {
        const file = relative(ROOT, abs);
        readFileSync(abs, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            BARE_ON_EVENT.lastIndex = 0;
            for (const m of line.matchAll(BARE_ON_EVENT)) {
              if (isDeniedMention(line, m.index)) continue; // "…there is no `onEvent`"
              out.push({
                file,
                line: i + 1,
                text: line.trim(),
                detail: 'names the observability hot path `onEvent`; it is `exportEvent`',
              });
            }
          });
      }
      return out;
    },
  },

  {
    id: 'skill-tools-activation-claim',
    headline: '`DefineSkillOptions.tools` claims its tools are gated on activation',
    why:
      "A Skill's tools go into the agent's tool registry at BUILD time and the model can call " +
      'them from iteration 1. Activation adds the BODY. Tools are held back only when ' +
      '`autoActivate: \'currentSkill\'` is set, so "once activated" describes the exception as ' +
      'if it were the default — and a reader who believes it ships tools they think are hidden.',
    fix:
      'Say when the tools are really visible (build time, iteration 1) and point at `autoActivate` ' +
      'for the gated behaviour. Note the rule does NOT exempt a negated sentence: write "activation ' +
      'adds the body, not the tools" rather than "tools are not added once activated".',
    find() {
      const file = 'src/lib/injection-engine/factories/defineSkill.ts';
      const lines = readLines(file);
      if (!lines) {
        return [
          {
            file,
            line: 0,
            text: '(file not found)',
            detail:
              'this rule is pinned to a path that no longer exists — re-point it at the new home of `DefineSkillOptions` instead of letting it silently pass',
          },
        ];
      }
      const out = [];
      // (a) activation-gating language inside the doc block attached to `tools`.
      //     Scoped, because "once activated" is TRUE of `body` two fields up.
      const toolsDoc = attachedDocLines(lines, /^\s*readonly\s+tools\s*\?:/);
      const GATED = /\bonce activated\b|\buntil activated\b|\bonly (?:when|while) activated\b/i;
      for (const n of [...toolsDoc].sort((a, b) => a - b)) {
        const line = lines[n - 1];
        if (!GATED.test(line)) continue;
        out.push({
          file,
          line: n,
          text: line.trim(),
          detail:
            'the doc comment attached to `tools` ties tool visibility to activation; tools are registered at build time unless `autoActivate` is set',
        });
      }
      // (b) "unlocked tools" anywhere in the file — activation unlocks nothing,
      //     so the metaphor is false wherever it appears, not just on `tools`.
      const UNLOCK =
        /\bunlock(?:s|ed|ing)?\b[^.\n]{0,30}\btools?\b|\btools?\b[^.\n]{0,30}\bunlock(?:s|ed|ing)?\b/i;
      lines.forEach((line, i) => {
        if (!UNLOCK.test(line)) return;
        out.push({
          file,
          line: i + 1,
          text: line.trim(),
          detail:
            'describes a Skill\'s tools as "unlocked" by activation; activation unlocks no tools',
        });
      });
      return out.sort((a, b) => a.line - b.line);
    },
  },

  {
    id: 'stale-version-promise',
    headline: 'a docstring still promises a version that has already shipped',
    why:
      `The package is at ${PKG_VERSION}. A comment saying a field "lands in v2.5" or is "a ` +
      'forward-compat marker" awaiting "v2.5 runtime wiring" tells a reader the feature does not ' +
      'work yet, six majors after it started working — so they build the workaround instead of ' +
      'using it. Only versions AT OR BELOW the current one are flagged: a note about a genuinely ' +
      'future release is a roadmap, not a lie.',
    fix: 'Describe what the code does TODAY. If the history matters, write it in the past tense ("wired at runtime since v2.5") — past-tense notes are not flagged.',
    find() {
      const out = [];
      // (a) The self-description that was wrong: "forward-compat marker".
      //     Scanned across all of src/. Note this is NOT the same string as the
      //     common, legitimate "forward-compat with graphs built before X" —
      //     `marker` is the word that claims the field does nothing yet.
      const MARKER = /forward[- ]compat(?:ibility)?\s+marker/i;
      for (const abs of scanFiles('src', ['.ts'])) {
        const file = relative(ROOT, abs);
        readFileSync(abs, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (!MARKER.test(line)) return;
            out.push({
              file,
              line: i + 1,
              text: line.trim(),
              detail:
                'calls the field a forward-compat marker — i.e. claims nothing reads it yet; verify against the runtime and describe what it does today',
            });
          });
      }
      // (b) Future-tense version promises in the injection engine, where the
      //     defect lived. General rather than a literal "v2.5" match: a
      //     PROMISE CUE near a version reference that is already at or below
      //     the shipped version. History cues ("since v2.5") never fire.
      for (const abs of scanFiles('src/lib/injection-engine', ['.ts'])) {
        const file = relative(ROOT, abs);
        const text = readFileSync(abs, 'utf8');
        const comments = commentLineNumbers(text);
        text.split('\n').forEach((line, i) => {
          if (!comments.has(i + 1)) return; // prose only; code is not a promise
          VERSION_REF.lastIndex = 0;
          for (const m of line.matchAll(VERSION_REF)) {
            const promised = `${m[1]}.${m[2]}.${m[3] ?? 0}`;
            if (cmpVersion(promised, PKG_VERSION) > 0) continue; // still in the future — fine
            const near = line.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70);
            if (!PROMISE_CUE.test(near) || HISTORY_CUE.test(near)) continue;
            out.push({
              file,
              line: i + 1,
              text: line.trim(),
              detail: `promises something for v${m[1]}.${m[2]} in the future tense, but the package is at ${PKG_VERSION} — that version is the past`,
            });
            break; // one finding per line is enough to act on
          }
        });
      }
      return out;
    },
  },

  {
    id: 'strategy-lifecycle-consumer-only',
    headline: 'prose says the framework never calls `flush()` / `stop()`',
    why:
      'It did not, through 8.11.x, and the docs said so loudly. Since 8.12.0 three doors call ' +
      'them: the handle `enable.*` returns (`handle.flush()` / `handle.stop()`), ' +
      '`agent.shutdown()`, and a `standingAgent` closing with the default `shutdown: \'flush\'`. ' +
      'A reader who believes the old sentence writes a SIGTERM handler that duplicates work the ' +
      'library now does — or, worse, concludes the tail batch is still being dropped and builds ' +
      'a workaround around a bug that is fixed.',
    fix:
      'Say who calls it now: the handle, `agent.shutdown()`, a closing `standingAgent`. The one ' +
      'thing that is still true and worth keeping: `agent.run()` never flushes, and an ' +
      'Unsubscribe never stops a strategy.',
    // Scoped to the lifecycle prose — `src/strategies`, the AWS exporter
    // adapters, and the docs that describe them. The phrasing list is
    // deliberately literal: these are the exact sentences 8.11.0 shipped.
    find() {
      const NEVER_CALLS =
        /(framework|library|agentfootprint)\s+(never|does not|doesn't)\s+(call|invoke)s?\b|\bCONSUMER-CALLED\b|does not call (this|it|them) for you|nothing in the framework calls them/i;
      const files = [
        ...scanFiles('src/strategies', ['.ts']),
        ...scanFiles('src/adapters/observability', ['.ts']),
        ...scanFiles('docs-next/content/docs/monitor', ['.mdx']),
        ...scanFiles('docs-next/content/docs/reference', ['.mdx']),
      ];
      const out = [];
      for (const abs of files) {
        const file = relative(ROOT, abs);
        readFileSync(abs, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (!NEVER_CALLS.test(line)) return;
            // The one true remaining negative: `run()` really does not flush.
            if (/\brun\(\)/.test(line)) return;
            out.push({
              file,
              line: i + 1,
              text: line.trim(),
              detail:
                'says the framework never calls flush()/stop(); since 8.12.0 the enable.* handle, ' +
                'agent.shutdown() and a closing standingAgent all do',
            });
          });
      }
      return out;
    },
  },

  // ── DELIBERATELY ABSENT: "`composeObservability` near `agentfootprint/observe`" ──
  //
  // A fourth rule was drafted for it and rejected, because the premise was
  // false: `agentfootprint/observe` resolves to `dist/doors/observe.js`
  // (package.json "exports"), and `src/doors/observe.ts` does
  // `export * from '../strategies/index.js'` — so it really does export
  // `composeObservability`, alongside `agentfootprint/strategies`. The doc
  // sites are correct and the rule would have flagged correct documentation
  // forever. The mistake came from probing `dist/observe.js`, a build artifact
  // that is NOT the published entry point.
  //
  // The lesson is the one this whole script is built on: the EXPORT MAP is the
  // authority on what is importable, never the file tree. `buildSurface()`
  // resolves every subpath through package.json for exactly this reason, and
  // any future rule about where a symbol lives must call `precondition(surface)`
  // and read `surface.perSubpath` rather than assume.
];

function runDocTextRules(surface) {
  // One line can break the same rule twice ("Optional unlocked tools, added to
  // the tools slot once activated" is two separate false claims). That is ONE
  // line to edit, so it is one finding carrying both reasons.
  const byLine = new Map();
  for (const rule of DOC_TEXT_RULES) {
    if (rule.precondition && !rule.precondition(surface)) continue;
    for (const f of rule.find()) {
      const key = `${rule.id}|${f.file}|${f.line}`;
      const existing = byLine.get(key);
      if (existing) {
        if (!existing.detail.includes(f.detail)) existing.detail += `; also ${f.detail}`;
        continue;
      }
      byLine.set(key, {
        rule: rule.id,
        headline: rule.headline,
        fix: rule.fix,
        why: rule.why,
        ...f,
      });
    }
  }
  return [...byLine.values()].sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line,
  );
}

// ─────────────────────────────────────────────────────────────────────
// 4. Classify
// ─────────────────────────────────────────────────────────────────────

const CATEGORY = {
  PHANTOM: 'docs-promise-nothing',
  DEAD: 'documented-never-exercised',
  DOC_GAP: 'exercised-undocumented',
  UNKNOWN: 'undocumented-unexercised',
  CODE_ONLY: 'site-code-sample-only',
  REPO_ONLY: 'written-but-not-published',
  OK: 'ok',
};

function byProminence(a, b) {
  const rank = (r) => [
    r.rootBarrel ? 0 : 1,
    KIND_ORDER.indexOf(r.kind) === -1 ? 99 : KIND_ORDER.indexOf(r.kind),
    r.name.toLowerCase(),
  ];
  const pa = rank(a);
  const pb = rank(b);
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function classify(surface, docs, exercised, events) {
  const exercisedNames = new Set(exercised?.symbolsReferenced ?? []);
  const observedEvents = new Set(exercised?.eventsObserved ?? []);
  const haveEvidence = Boolean(exercised);

  const rows = [];
  for (const sym of surface.symbols.values()) {
    const inSiteProse = docs.siteProse.has(sym.name);
    const inSiteCode = docs.siteCode.has(sym.name);
    const inRepoProse = docs.repoProse.has(sym.name);

    // Precedence: published prose > published code sample > repo prose > nothing.
    const documented = inSiteProse
      ? 'site-prose'
      : inSiteCode
      ? 'site-code-only'
      : inRepoProse
      ? 'repo-only'
      : 'absent';
    const exercisedCol = !haveEvidence
      ? 'unknown'
      : exercisedNames.has(sym.name)
      ? 'yes'
      : 'unknown';

    let category;
    if (documented === 'site-prose')
      category = exercisedCol === 'yes' ? CATEGORY.OK : CATEGORY.DEAD;
    else if (documented === 'site-code-only') category = CATEGORY.CODE_ONLY;
    else if (documented === 'repo-only') category = CATEGORY.REPO_ONLY;
    else category = exercisedCol === 'yes' ? CATEGORY.DOC_GAP : CATEGORY.UNKNOWN;

    rows.push({
      name: sym.name,
      kind: sym.kind,
      subpaths: sym.subpaths.slice().sort(),
      rootBarrel: sym.subpaths.includes('.'),
      documented,
      exercised: exercisedCol,
      category,
      inRepoProse,
      hasGeneratedPage: docs.generatedSymbols.has(sym.name),
      sitePages: inSiteProse ? [...docs.siteProse.get(sym.name)].sort().slice(0, 3) : [],
      repoPages: inRepoProse ? [...docs.repoProse.get(sym.name)].sort().slice(0, 3) : [],
    });
  }
  rows.sort(byProminence);

  // ── Events ──
  const eventRows = events.names.map((name) => {
    const m = docs.eventMentions.get(name);
    const documented = m?.siteProse.size
      ? 'site-prose'
      : m?.siteCode.size
      ? 'site-code-only'
      : m?.repoProse.size
      ? 'repo-only'
      : 'absent';
    const exercisedCol = !haveEvidence ? 'unknown' : observedEvents.has(name) ? 'yes' : 'unknown';
    let category;
    if (documented === 'site-prose')
      category = exercisedCol === 'yes' ? CATEGORY.OK : CATEGORY.DEAD;
    else if (documented === 'site-code-only') category = CATEGORY.CODE_ONLY;
    else if (documented === 'repo-only') category = CATEGORY.REPO_ONLY;
    else category = exercisedCol === 'yes' ? CATEGORY.DOC_GAP : CATEGORY.UNKNOWN;
    return {
      name,
      documented,
      exercised: exercisedCol,
      category,
      sitePages: m ? [...m.siteProse].sort().slice(0, 2) : [],
    };
  });

  // ── Phantoms: the published docs promise something that does not exist ──
  //
  // Three genuinely different bugs hide in "the docs name something that is not
  // in the surface", and collapsing them would either cry wolf or hide a real
  // defect, so they are separated:
  //
  //   phantoms (GATE, never baselined) — an IMPORT a reader can copy that
  //     cannot resolve, or an event name that appears nowhere in src at all.
  //     Unambiguous. Zero tolerance.
  //   unregisteredEvents (RATCHETED) — the docs name an event that src really
  //     DOES emit, but the typed registry does not contain it. The docs are
  //     right and the type contract is wrong; a consumer cannot subscribe in
  //     TypeScript. A library defect, not doc rot — reported loudly, ratcheted
  //     rather than gated because it needs an owner's decision to fix.
  //   advisories (REPORT ONLY) — prose names an `agentfootprint/<x>` path the
  //     export map lacks, outside any import statement. This bucket legitimately
  //     contains deliberate future-tense mentions ("we would promote it to
  //     agentfootprint/governance in a future minor"), so it needs human triage
  //     and must never fail a build.
  const phantoms = [];
  const unregisteredEvents = [];
  const advisories = [];

  for (const use of docs.importUses) {
    const subpath =
      use.spec === 'agentfootprint' ? '.' : `.${use.spec.slice('agentfootprint'.length)}`;
    if (!surface.perSubpath.has(subpath)) {
      phantoms.push({
        kind: 'missing-subpath',
        symbol: use.spec,
        detail: `the docs import from '${use.spec}', which package.json "exports" does not expose`,
        page: use.file,
      });
      continue;
    }
    const exportedHere = new Set(surface.perSubpath.get(subpath));
    for (const name of use.names) {
      if (exportedHere.has(name)) continue;
      const elsewhere = surface.symbols.get(name);
      phantoms.push(
        elsewhere
          ? {
              kind: 'wrong-subpath',
              symbol: name,
              detail: `the docs import { ${name} } from '${
                use.spec
              }', but it is exported from ${elsewhere.subpaths.join(
                ', ',
              )} — the copy-pasted import fails`,
              page: use.file,
            }
          : {
              kind: 'missing-symbol',
              symbol: name,
              detail: `the docs import { ${name} } from '${use.spec}', and no subpath exports it`,
              page: use.file,
            },
      );
    }
  }

  const importedSpecs = new Set(docs.importUses.map((u) => u.spec));
  for (const [spec, pages] of docs.subpathMentions) {
    const subpath = `.${spec.slice('agentfootprint'.length)}`;
    if (surface.perSubpath.has(subpath) || spec === 'agentfootprint/package.json') continue;
    if (importedSpecs.has(spec)) continue; // already gated above as missing-subpath
    advisories.push({
      kind: 'prose-subpath-claim',
      symbol: spec,
      detail: `prose names the import path '${spec}', which package.json "exports" does not expose`,
      pages: [...pages].sort(),
    });
  }

  const declaredEvents = new Set(events.names);
  for (const [name, where] of docs.eventMentions) {
    if (declaredEvents.has(name)) continue;
    const sitePages = where.siteProse.size ? where.siteProse : where.siteCode;
    if (sitePages.size === 0) continue; // repo-internal only — not a reader-facing promise
    const emitter = docs.emittedEventLiterals.get(name);
    if (emitter) {
      unregisteredEvents.push({
        kind: 'emitted-but-not-registered',
        symbol: name,
        detail: `the docs name '${name}' and src really emits it (${emitter}), but it is absent from ALL_EVENT_TYPES (${events.source}) — so it has no payload type, no domain wildcard, and a consumer cannot subscribe to it in TypeScript`,
        page: [...sitePages].sort()[0],
        emitter,
      });
    } else {
      phantoms.push({
        kind: 'phantom-event',
        symbol: name,
        detail: `the docs name the event '${name}', which is neither in ALL_EVENT_TYPES nor emitted anywhere in src`,
        page: [...sitePages].sort()[0],
      });
    }
  }

  const dedupe = (list) => {
    const seen = new Set();
    return list
      .filter((p) => {
        const key = `${p.kind}|${p.symbol}|${p.page ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.symbol.localeCompare(b.symbol));
  };

  return {
    rows,
    eventRows,
    phantoms: dedupe(phantoms),
    unregisteredEvents: dedupe(unregisteredEvents),
    advisories: dedupe(advisories),
    // Sentence-level, not name-level: prose in the code (and on the pages that
    // quote it) that contradicts the code. Gated, never baselined — see 3c.
    docText: runDocTextRules(surface),
    haveEvidence,
  };
}

function summarise(result) {
  const tally = (rows) => {
    const out = {};
    for (const key of Object.values(CATEGORY)) out[key] = 0;
    for (const r of rows) out[r.category]++;
    return out;
  };
  return {
    symbols: tally(result.rows),
    events: tally(result.eventRows),
    phantoms: result.phantoms.length,
    unregisteredEvents: result.unregisteredEvents.length,
    advisories: result.advisories.length,
    docTextViolations: result.docText.length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 5. Ratchet
// ─────────────────────────────────────────────────────────────────────

/**
 * The ratcheted sets. "Undocumented" is exactly the stated DOCUMENTED
 * definition: NOT described in prose on a published, hand-written page.
 */
function tracked(result) {
  return {
    undocumentedSymbols: result.rows
      .filter((r) => r.documented !== 'site-prose')
      .map((r) => r.name)
      .sort(),
    undocumentedEvents: result.eventRows
      .filter((r) => r.documented !== 'site-prose')
      .map((r) => r.name)
      .sort(),
    // Library defect, not doc rot: emitted for real, missing from the typed
    // registry. Ratcheted (a NEW one fails) rather than gated, because closing
    // an existing one changes the public event contract and needs an owner.
    unregisteredEmittedEvents: result.unregisteredEvents.map((p) => p.symbol).sort(),
  };
}

function buildBaseline(result, surface, events, exercised) {
  const t = tracked(result);
  return {
    $schema: 'docs-truth baseline v1',
    note:
      'Recorded state of the docs-vs-code gap. CI fails only when this gets WORSE. ' +
      'Fixed a gap? Run `npm run docs:truth:baseline` to re-record and regenerate ' +
      'docs/DOCS_TRUTH_REPORT.md. The "docs-promise-nothing" class is NEVER baselined — ' +
      'it must always be zero.',
    documentedMeans:
      'the symbol name appears in prose (outside any fenced code block) on a hand-written ' +
      'page under docs-next/content/docs. The two generated TypeDoc trees ' +
      '(docs-next/content/docs/api, docs/api-reference) are excluded — they are generated ' +
      'from source, so counting them would mark everything documented.',
    recordedAt: new Date().toISOString().slice(0, 10),
    surface: {
      subpaths: surface.subpaths.length,
      declaredSymbols: surface.symbols.size,
      declaredEvents: events.names.length,
      eventSource: events.source,
    },
    counts: summarise(result),
    exercisedEvidence: exercised
      ? {
          recordedAt: exercised.recordedAt,
          examplesRun: exercised.totals?.total ?? null,
          examplesPassed: exercised.totals?.passed ?? null,
          eventTypesObserved: exercised.eventsObserved?.length ?? 0,
        }
      : null,
    undocumentedSymbols: t.undocumentedSymbols,
    undocumentedEvents: t.undocumentedEvents,
    unregisteredEmittedEvents: t.unregisteredEmittedEvents,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 6. Human-readable report
// ─────────────────────────────────────────────────────────────────────

function fmtSubpaths(r) {
  return r.subpaths
    .map((s) => (s === '.' ? '`agentfootprint`' : `\`agentfootprint${s.slice(1)}\``))
    .join(' ');
}

function table(rows, limit = null) {
  if (rows.length === 0) return '_None._';
  const shown = limit ? rows.slice(0, limit) : rows;
  const lines = ['| Symbol | Kind | Exported from |', '|---|---|---|'];
  for (const r of shown) lines.push(`| \`${r.name}\` | ${r.kind} | ${fmtSubpaths(r)} |`);
  if (limit && rows.length > limit) {
    lines.push(
      `| … | | _${
        rows.length - limit
      } more. Every undocumented name is listed in \`docs/docs-truth/baseline.json\`; for the full classified table run \`node scripts/docs-truth-check.mjs --json out.json\`_ |`,
    );
  }
  return lines.join('\n');
}

function buildReport(result, surface, events, exercised, docs, baseline) {
  const c = summarise(result);
  const s = c.symbols;
  const e = c.events;
  const total = result.rows.length;
  const inProse = result.rows.filter((r) => r.documented === 'site-prose').length;
  const byCat = (cat) => result.rows.filter((r) => r.category === cat);
  const trapCount = result.rows.filter(
    (r) => r.documented !== 'site-prose' && r.hasGeneratedPage,
  ).length;

  // The same gap, counted by several rules — because "how many are
  // undocumented?" has no single honest answer at symbol granularity.
  const callable = (r) => r.kind === 'function' || r.kind === 'class';
  const undoc = result.rows.filter((r) => r.documented !== 'site-prose');
  const undocAll = undoc.length;
  const absentAll = result.rows.filter((r) => r.documented === 'absent').length;
  const undocRunnable = undoc.filter(callable).length;
  const undocRoot = undoc.filter((r) => r.rootBarrel).length;
  const undocRootRunnable = undoc.filter((r) => r.rootBarrel && callable(r)).length;
  const undocRunnableExercised = result.rows.filter(
    (r) => r.category === CATEGORY.DOC_GAP && callable(r),
  ).length;
  const undocEvents = result.eventRows.filter((r) => r.documented !== 'site-prose').length;

  const L = [];
  L.push('# Docs-truth report');
  L.push('');
  L.push(
    '<!-- GENERATED by `npm run docs:truth:baseline` (scripts/docs-truth-check.mjs). Do not hand-edit. -->',
  );
  L.push('');
  L.push(`_Recorded ${new Date().toISOString().slice(0, 10)}._`);
  L.push('');

  // ── plain prose summary, before any table ──
  L.push('## In plain words');
  L.push('');
  L.push(
    `The package publishes **${surface.subpaths.length} import paths** carrying **${total} distinct named exports**, plus **${events.names.length} typed events**. For each one this report asks three separate questions: is it really *exported* (declared), is it *described in prose on the published docs site* (documented), and does a *real run actually use it* (exercised).`,
  );
  L.push('');
  L.push(
    `**${inProse} of ${total} exports (${Math.round(
      (inProse / total) * 100,
    )}%) are described in prose on the site.** The rest split into five different problems, which is the whole point of keeping the columns apart:`,
  );
  L.push('');
  L.push(
    [
      `- **${
        s[CATEGORY.DOC_GAP]
      } exist, provably work, and are undocumented.** A reference run exercises them and no page on the site describes them. This is the honest headline number for "features that work and nobody has written about". It is the list to work through.`,
      `- **${
        s[CATEGORY.REPO_ONLY]
      } are already written up, just not published.** Prose about them exists inside the repo (\`docs/\`, \`README.md\`) but never made it onto the site. These are cheap wins: the writing is done, it needs moving.`,
      `- **${
        s[CATEGORY.CODE_ONLY]
      } appear only inside a code sample** and nowhere in the surrounding text. A reader scanning the page never learns they exist, and site search does not find them.`,
      `- **${
        s[CATEGORY.UNKNOWN]
      } are undocumented and no reference run touches them.** This report will not guess whether they work. They are reported as UNKNOWN, which is the honest answer, and they need a human pass.`,
      `- **${
        s[CATEGORY.DEAD]
      } are documented but no reference run exercises them.** For a function or a class that is the shape a dead or unimplemented feature has. For a type or an interface it is mostly noise, because a type is used, not called — so read that class by kind, and the tables below split it.`,
    ].join('\n'),
  );
  L.push('');
  L.push(
    `On events: **${e[CATEGORY.OK]}** of the ${
      events.names.length
    } typed events are both described on the site and were seen firing in a real run. **${
      e[CATEGORY.DEAD]
    }** ${
      e[CATEGORY.DEAD] === 1 ? 'is described but was' : 'are described but were'
    } never observed firing — that is exactly the shape the resilience events had for months (fully declared, with payload types, and zero emitters), so this number is worth a look every time it moves. **${
      e[CATEGORY.DOC_GAP] + e[CATEGORY.UNKNOWN] + e[CATEGORY.CODE_ONLY] + e[CATEGORY.REPO_ONLY]
    }** are not described in prose on the site at all.`,
  );
  L.push('');
  L.push('### Which number is "the" number');
  L.push('');
  L.push(
    `A previous inventory put the undocumented-feature count at roughly 36. That figure does not reproduce at symbol granularity, and it is worth being explicit about why rather than quietly picking a number: one *feature* is usually three or four *symbols* (a factory, its options interface, its returned handle type), so the two counts cannot match. Counted every way this data supports:`,
  );
  L.push('');
  L.push('| Counting rule | Undocumented |');
  L.push('|---|---|');
  L.push(`| every named export not in site prose | ${undocAll} |`);
  L.push(`| … of those, absent from every prose anywhere in the repo | ${absentAll} |`);
  L.push(`| only functions and classes (things you can call) | ${undocRunnable} |`);
  L.push(`| only exports on the root barrel | ${undocRoot} |`);
  L.push(`| **functions and classes on the root barrel** | **${undocRootRunnable}** |`);
  L.push(`| functions and classes that a reference run proves work | ${undocRunnableExercised} |`);
  L.push(`| typed events | ${undocEvents} |`);
  L.push('');
  L.push(
    `The closest analogue to the remembered 36 is the **${undocRootRunnable} callable things on the root barrel with no prose description** — near enough that the old inventory was probably counting something like it, and far enough from ${undocAll} that quoting a single "undocumented" number without saying which rule produced it is how a figure like 36 drifts. Every table below states its rule.`,
  );
  L.push('');
  if (result.phantoms.length === 0) {
    L.push(
      '**The worst class is empty: nowhere do the published docs tell a reader to import something that does not exist.** That check is not baselined — it fails the build immediately, always, because a reader who copies such a line is simply broken.',
    );
  } else {
    L.push(
      `**${result.phantoms.length} place(s) in the published docs promise something that does not exist.** This is the worst class for a reader — they copy the line and it fails. It is listed first below, and it fails the build immediately regardless of baseline.`,
    );
  }
  L.push('');
  if (result.unregisteredEvents.length > 0) {
    L.push(
      `**The most alarming single finding is a different shape, and it is a library defect rather than a documentation one: ${result.unregisteredEvents.length} event(s) that the code really emits are missing from the typed event registry.** The docs describe them, the runtime fires them, and yet they are not in \`ALL_EVENT_TYPES\` — so they have no payload type, no domain wildcard, and a consumer cannot subscribe to them in TypeScript at all. Details in section 2. This report does not fix them: which names are correct is a public-contract decision for the author.`,
    );
    L.push('');
  }
  if (result.advisories.length > 0) {
    L.push(
      `Separately, **${result.advisories.length} import path(s) named in prose do not exist in the export map**. That list needs human eyes rather than a build failure, because it legitimately mixes real errors (a "legacy alias" the docs say still resolves, but which the export map dropped) with deliberate future-tense notes ("we would promote it to … in a future minor"). It is section 8, and it never fails the build.`,
    );
    L.push('');
  }
  L.push(
    exercised
      ? `Reference-run evidence: **${exercised.totals.passed} of ${exercised.totals.total}** example scripts in \`examples/\` ran green with **zero credentials** on ${exercised.recordedAt} (Node ${exercised.node}), and **${exercised.eventsObserved.length}** distinct event types were observed firing.`
      : 'Reference-run evidence: **none recorded**, so the EXERCISED column is UNKNOWN for everything.',
  );
  L.push('');

  // ── folder policy ──
  L.push('## Which docs folder counts, and why');
  L.push('');
  L.push(
    'The repo has four documentation locations and they are not equivalent. Getting this wrong is the one mistake that would make this whole report worthless, so the policy is stated up front:',
  );
  L.push('');
  L.push('| Location | Files | Counts as documentation? |');
  L.push('|---|---|---|');
  L.push(
    `| \`docs-next/content/docs/**.mdx\` (hand-written) | ${docs.sitePageCount} | **Yes — the truth source.** This is what the published site renders and what a reader sees. |`,
  );
  L.push(
    `| \`docs-next/content/docs/api/**\` (TypeDoc-generated) | ${docs.generatedInSiteCount} | **No — excluded.** |`,
  );
  L.push(
    `| \`docs/api-reference/**\` (TypeDoc-generated) | ${docs.generatedLegacyCount} | **No — excluded.** |`,
  );
  L.push(
    `| \`docs/**.md\` + \`README.md\` (repo-internal prose) | ${docs.repoPageCount} | **No** — but tracked as its own state, "written but not published". |`,
  );
  L.push('');
  L.push(
    `Both generated trees are produced **from the source**, so every exported symbol appears in them by construction. Counting either as documentation would mark **${trapCount}** currently-undocumented symbols as documented, collapse most of this report to zero, and hand back a clean bill of health that means nothing. False reassurance in the exact place the author is trying to establish trust is worse than having no check, so both are excluded.`,
  );
  L.push('');
  L.push(
    `Neither generated tree is trustworthy as documentation for a second reason: **nothing in CI checks either one.** \`docs/api-reference/\` is regenerated only by \`npm run docs:api\`, which no workflow runs; it was last committed well behind \`src/\`, so it is known-stale. That is a pre-existing problem the author already knows about, and this check deliberately does not try to fix it — but it should not be mistaken for documentation.`,
  );
  L.push('');

  L.push('## What the existing CI docs gate already covers');
  L.push('');
  L.push(
    `CI's \`docs\` job builds docs-next, which twoslash-compiles code blocks marked \`ts twoslash\` against the real types. That gate is real, and where it applies nothing can drift. It just applies narrowly: **${
      docs.fenceTotals.twoslash
    } of the ${
      docs.fenceTotals.twoslash + docs.fenceTotals.ungatedCode
    } TypeScript/JavaScript blocks on the site are twoslash-marked**, and **${
      docs.fenceTotals.packageImportsUngated
    } \`import … from 'agentfootprint…'\` lines sit inside blocks the compiler never sees**. Three genuinely broken imports were found in exactly that blind spot while this report was first built (plain \`typescript\`-tagged fences in \`reference/strategy-everywhere.mdx\`), which is the concrete argument for checking the export map directly rather than trusting the build to catch it.`,
  );
  L.push('');

  // ── column definitions ──
  L.push('## What each column means');
  L.push('');
  L.push('| Column | Definition used here |');
  L.push('|---|---|');
  L.push(
    `| **DECLARED** | The symbol is exported from a shipped \`.d.ts\` reachable through a \`package.json\` \`"exports"\` subpath, enumerated with the TypeScript checker so \`export *\` chains resolve exactly as a consumer's compiler sees them. Deliberately **not** TypeDoc: TypeDoc runs from one entry point (\`src/index.ts\`), so it cannot see any \`agentfootprint/<subpath>\` symbol at all. Events come from \`ALL_EVENT_TYPES\` (\`${events.source}\`), whose count is pinned by \`test/events/unit/registry.test.ts\`. |`,
  );
  L.push(
    '| **DOCUMENTED** | The name appears in **prose** on a hand-written page under `docs-next/content/docs` — anywhere outside a fenced code block. Headings, paragraphs, table cells, inline `` `code` `` spans and frontmatter `title`/`description` all count as prose. A name that appears *only* inside a fenced sample is **not** documented and is reported as its own category. The two generated trees are excluded (see above). |',
  );
  L.push(
    '| **EXERCISED** | For events: the event was observed on the event bus during a credential-free run of the repo\'s own `examples/`. For symbols: the symbol is imported by an example script that ran green. This signal **over-counts** (an import on a branch never taken still counts), so every gap number here is a **floor**, never a ceiling. Anything the evidence cannot speak to is **UNKNOWN**, never "absent". |',
  );
  L.push('');

  // ── the gaps ──
  L.push('## The gaps, worst class first');
  L.push('');
  L.push(
    "Within each class, symbols exported from the root barrel (`import { X } from 'agentfootprint'`) come first — they are what a reader meets on page one — then by kind (functions and classes before types), then alphabetically.",
  );
  L.push('');

  L.push('### 1. The published docs promise something that does not exist');
  L.push('');
  L.push(
    'A reader copies the line and it fails. Zero tolerance: this class fails the build regardless of baseline.',
  );
  L.push('');
  if (result.phantoms.length === 0) {
    L.push('**None. ✅**');
  } else {
    L.push('| Problem | What the docs say | Page |');
    L.push('|---|---|---|');
    for (const p of result.phantoms) L.push(`| ${p.kind} | ${p.detail} | \`${p.page}\` |`);
  }
  L.push('');

  L.push('### 2. Emitted for real, but missing from the typed event registry');
  L.push('');
  L.push(
    'The inverse of doc rot: the documentation is right and the **code contract** is wrong. These event names are emitted by `src/`, and described on the site, but they are not in `ALL_EVENT_TYPES`. The consequences are concrete: no payload interface, no entry in `EVENT_NAMES`, no `agentfootprint.<domain>.*` wildcard, and `runner.on(...)` will not accept the string because its overloads are keyed on `AgentfootprintEventType`. A reader who follows the docs and subscribes gets a type error, or silence.',
  );
  L.push('');
  L.push(
    "This is **ratcheted, not gated**: a *new* one fails the build, but closing an existing one means changing the published event contract (and the event count that `test/events/unit/registry.test.ts` pins), which is the author's call, not this check's.",
  );
  L.push('');
  if (result.unregisteredEvents.length === 0) L.push('**None. ✅**');
  else {
    L.push('| Event named in the docs | Really emitted at | Documented on |');
    L.push('|---|---|---|');
    for (const p of result.unregisteredEvents) {
      L.push(`| \`${p.symbol}\` | \`${p.emitter}\` | \`${p.page}\` |`);
    }
  }
  L.push('');

  L.push('### 3. Declared + exercised + not documented — the classic doc gap');
  L.push('');
  L.push(
    `These provably work — a reference run touches them — and no page on the site describes them. **${
      byCat(CATEGORY.DOC_GAP).length
    } symbols.**`,
  );
  L.push('');
  L.push(table(byCat(CATEGORY.DOC_GAP)));
  L.push('');

  L.push('### 4. Declared + documented + never exercised — possibly dead or unimplemented');
  L.push('');
  L.push(
    'The site describes it and it really is exported, but no reference run touches it. Split by kind, because the class only means "possibly dead" for things that can be called.',
  );
  L.push('');
  const deadEvents = result.eventRows.filter((r) => r.category === CATEGORY.DEAD);
  L.push(`**Events described on the site but never observed firing (${deadEvents.length}).**`);
  L.push('');
  if (deadEvents.length === 0) L.push('_None._');
  else {
    L.push('| Event | Described on |');
    L.push('|---|---|');
    for (const r of deadEvents)
      L.push(`| \`${r.name}\` | ${r.sitePages.map((p) => `\`${p}\``).join(', ') || '—'} |`);
  }
  L.push('');
  const deadRunnable = byCat(CATEGORY.DEAD).filter(
    (r) => r.kind === 'function' || r.kind === 'class',
  );
  const deadTypes = byCat(CATEGORY.DEAD).length - deadRunnable.length;
  L.push(
    `**Functions and classes described on the site but not touched by any reference run (${deadRunnable.length}).** The other ${deadTypes} in this class are types, interfaces and constants, which a run cannot "call" — they are named in \`docs/docs-truth/baseline.json\` rather than here.`,
  );
  L.push('');
  L.push(table(deadRunnable));
  L.push('');

  L.push('### 5. Written but not published');
  L.push('');
  L.push(
    `Prose about these exists in the repo (\`docs/\`, \`README.md\`) but nothing on the site mentions them. The writing is already done — this is a publishing job, not an authoring job, which makes it the cheapest class to close. **${
      byCat(CATEGORY.REPO_ONLY).length
    } symbols.**`,
  );
  L.push('');
  const repoOnly = byCat(CATEGORY.REPO_ONLY);
  if (repoOnly.length === 0) L.push('_None._');
  else {
    const shown = repoOnly;
    L.push('| Symbol | Kind | Exported from | Already written up in |');
    L.push('|---|---|---|---|');
    for (const r of shown) {
      L.push(
        `| \`${r.name}\` | ${r.kind} | ${fmtSubpaths(r)} | ${r.repoPages
          .map((p) => `\`${p}\``)
          .join(', ')} |`,
      );
    }
    if (repoOnly.length > shown.length) {
      L.push(
        `| … | | | _${
          repoOnly.length - shown.length
        } more — see \`docs/docs-truth/baseline.json\`_ |`,
      );
    }
  }
  L.push('');

  L.push('### 6. Mentioned only inside a code sample');
  L.push('');
  L.push(
    `The name appears in a fenced block on the site and nowhere in the surrounding text. Reported as its own class rather than silently counted either way. **${
      byCat(CATEGORY.CODE_ONLY).length
    } symbols.**`,
  );
  L.push('');
  L.push(table(byCat(CATEGORY.CODE_ONLY)));
  L.push('');

  L.push('### 7. Declared + not documented + not exercised — unknown');
  L.push('');
  L.push(
    `Nowhere in any prose, and no reference run covers them, so this report will not claim they work or that they are dead. Some are internal-shaped types that happen to be exported; some may genuinely be dead. **${
      byCat(CATEGORY.UNKNOWN).length
    } symbols.**`,
  );
  L.push('');
  L.push(table(byCat(CATEGORY.UNKNOWN), 120));
  L.push('');

  L.push('### 8. Advisory — import paths named in prose that the export map does not expose');
  L.push('');
  L.push(
    'Never fails the build, because this bucket needs judgement. It mixes two kinds of entry that look identical to a script: a **stale promise** (prose says a legacy alias "still resolves", but `package.json` `"exports"` has no such key, so it does not) and a **deliberate future-tense note** ("if 5+ consumers ship this shape we would promote it to …"). Only a human can tell them apart, so they are listed for triage rather than gated.',
  );
  L.push('');
  if (result.advisories.length === 0) L.push('_None._');
  else {
    L.push('| Path named in prose | Where |');
    L.push('|---|---|');
    for (const a of result.advisories) {
      L.push(`| \`${a.symbol}\` | ${a.pages.map((p) => `\`${p}\``).join(', ')} |`);
    }
  }
  L.push('');

  L.push('### 9. Doc text that contradicts the code');
  L.push('');
  L.push(
    'Every other section reasons about **names**: is the symbol exported, is the name mentioned, was it seen firing. This one reads **sentences**. Three defects shipped in 8.10.0 that were nothing but sentences — the symbols all existed, were exported and were documented, so every other check passed while the words were wrong. Doc comments are copied verbatim into the emitted `.d.ts`, which makes a wrong sentence part of the published surface: it is what a consumer sees on hover.',
  );
  L.push('');
  L.push(
    'These are **targeted greps, one per established defect**, listed in `DOC_TEXT_RULES` (`scripts/docs-truth-check.mjs`). They are a **gate, not a ratchet**: unlike the undocumented-symbol counts, whose steady state is hundreds of known gaps, the steady state of each rule here is zero by construction — a rule is only added once the sentence it describes has been established as false, so there is nothing to ratchet and baselining one would mean shipping a known-false sentence deliberately.',
  );
  L.push('');
  if (result.docText.length === 0) L.push('**None. ✅**');
  else {
    L.push('| Rule | Where | What is wrong |');
    L.push('|---|---|---|');
    for (const f of result.docText) {
      L.push(`| \`${f.rule}\` | \`${f.file}:${f.line}\` | ${f.detail} |`);
    }
  }
  L.push('');

  // ── per-subpath ──
  L.push('## Per-subpath surface');
  L.push('');
  L.push(
    'Whether a symbol comes from the root barrel or only from a subpath is a documented source of user confusion in this repo, so the surface is reported per import path. Note that some subpaths are supersets of others (`agentfootprint/observe` re-exports everything in `agentfootprint/debug`), so these counts do not sum to the total.',
  );
  L.push('');
  L.push('| Import path | Exports | Described in site prose | Coverage |');
  L.push('|---|---|---|---|');
  const rowByName = new Map(result.rows.map((r) => [r.name, r]));
  for (const sp of surface.subpaths) {
    const names = surface.perSubpath.get(sp) ?? [];
    const documented = names.filter((n) => rowByName.get(n)?.documented === 'site-prose').length;
    const spec = sp === '.' ? 'agentfootprint' : `agentfootprint${sp.slice(1)}`;
    const pct = names.length ? Math.round((documented / names.length) * 100) : 0;
    L.push(`| \`${spec}\` | ${names.length} | ${documented} | ${pct}% |`);
  }
  L.push('');

  // ── limits ──
  L.push('## Honest limits of this report');
  L.push('');
  L.push(
    [
      '- **Name-level matching.** A symbol counts as documented when its *name* appears in prose. A page that happens to use the word `Trace` while meaning something else would count. This over-counts documentation, so every gap number here is a **floor**.',
      '- **EXERCISED over-counts too.** An example that imports a symbol but never reaches the line still marks it exercised, so class 4 ("possibly dead") is a floor as well.',
      '- **Only what a run can show.** Events are captured from the event bus with every listener gate forced open. An event emitted only by a recorder that no example ever attaches would be missed — and is reported UNKNOWN, not absent.',
      '- **`npm run test:examples` is not part of CI.** `.github/workflows/ci.yml` runs `test:types`, `build`, `test`, `publint` and `attw`; the examples are only typechecked inside the test suite, never executed there. The EXERCISED column therefore comes from a **committed recording** refreshed by `npm run docs:truth:exercise`, not from a per-commit run. A stale recording ages that column and nothing in CI notices.',
      '- **Types cannot be run.** Interfaces and type aliases appear as never-exercised almost by construction; classes 3 and 6 must be read with that in mind.',
      '- **Symbol granularity, not feature granularity.** One "feature" is usually a factory plus its options interface plus its handle type — three symbols. A count of undocumented *symbols* is therefore several times larger than a count of undocumented *features*.',
    ].join('\n'),
  );
  L.push('');

  // ── policy ──
  L.push('## How the check behaves in CI');
  L.push('');
  L.push(
    [
      '`npm run docs:truth` is a **ratchet, not a gate**. It compares against `docs/docs-truth/baseline.json` and fails only when things get worse:',
      '',
      '- a new export not described in site prose → **fail**',
      '- a new typed event not described in site prose → **fail**',
      '- the published docs promising something that does not exist → **fail, always, baseline or not**',
      '- a doc-text rule firing (section 9: prose that contradicts the code) → **fail, always, baseline or not**',
      `- the ${
        baseline?.undocumentedSymbols?.length ?? 0
      } pre-existing undocumented exports recorded in the baseline → **pass**. They are known debt, not a surprise. Failing on them would turn the check red on day one and get it deleted in a week, which is worse than no check.`,
      '',
      'Fixed some gaps? `npm run docs:truth:baseline` re-records the baseline and regenerates this report, so an improvement is locked in and cannot silently regress. Refresh the reference-run evidence with `npm run docs:truth:exercise` — it needs no credentials and never reads any.',
    ].join('\n'),
  );
  L.push('');
  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────

const surface = buildSurface();
const events = readDeclaredEvents();
const docs = buildDocIndex();
const exercised = readExercised();
const result = classify(surface, docs, exercised, events);
const counts = summarise(result);
const s = counts.symbols;
const e = counts.events;
const trapCount = result.rows.filter(
  (r) => r.documented !== 'site-prose' && r.hasGeneratedPage,
).length;

const banner = 'docs-truth check — declared vs documented vs exercised';
console.log(banner);
console.log('='.repeat(banner.length));
console.log(
  `surface        ${surface.subpaths.length} export subpaths · ${surface.symbols.size} distinct named exports · ${events.names.length} typed events (${events.source})`,
);
console.log(`docs counted   ${docs.sitePageCount} hand-written pages under docs-next/content/docs`);
console.log(
  `docs excluded  ${docs.generatedInSiteCount} generated (content/docs/api) + ${docs.generatedLegacyCount} generated (docs/api-reference) — both are built FROM source,`,
);
console.log(
  `               so counting them would mark ${trapCount} undocumented symbols "documented" and hide every gap`,
);
console.log(
  `docs tracked   ${docs.repoPageCount} repo-internal prose pages (docs/**, README.md) — "written but not published", not counted as documented`,
);
console.log(
  exercised
    ? `reference runs ${exercised.totals.passed}/${exercised.totals.total} examples green, zero credentials (recorded ${exercised.recordedAt}) · ${exercised.eventsObserved.length} event types observed firing`
    : 'reference runs NO EVIDENCE recorded — EXERCISED is UNKNOWN for everything (run: npm run docs:truth:exercise)',
);
console.log('');
console.log('DOCUMENTED means: the name appears in PROSE (outside any fenced code block) on a');
console.log('hand-written page under docs-next/content/docs. Code-sample-only, repo-internal-');
console.log('only, and generated-API-reference pages are NOT documentation here; the first two');
console.log('are reported as their own categories and the third is excluded entirely.');
console.log('');
const pad = (n) => String(n).padStart(4);
console.log(`symbols  documented on the site + exercised ....... ${pad(s[CATEGORY.OK])}`);
console.log(
  `         exercised, NOT documented ............... ${pad(
    s[CATEGORY.DOC_GAP],
  )}   the classic doc gap`,
);
console.log(
  `         written in the repo, not published ...... ${pad(
    s[CATEGORY.REPO_ONLY],
  )}   prose exists — publish it`,
);
console.log(`         mentioned only in a code sample ......... ${pad(s[CATEGORY.CODE_ONLY])}`);
console.log(
  `         not documented, not exercised ........... ${pad(
    s[CATEGORY.UNKNOWN],
  )}   UNKNOWN — not claimed either way`,
);
console.log(
  `         documented, never exercised ............. ${pad(
    s[CATEGORY.DEAD],
  )}   possibly dead or unimplemented`,
);
console.log(`events   documented on the site + observed firing . ${pad(e[CATEGORY.OK])}`);
console.log(`         observed firing, NOT documented ......... ${pad(e[CATEGORY.DOC_GAP])}`);
console.log(`         written in the repo, not published ...... ${pad(e[CATEGORY.REPO_ONLY])}`);
console.log(`         mentioned only in a code sample ......... ${pad(e[CATEGORY.CODE_ONLY])}`);
console.log(
  `         not documented, not observed ............ ${pad(e[CATEGORY.UNKNOWN])}   UNKNOWN`,
);
console.log(
  `         documented, never observed firing ....... ${pad(
    e[CATEGORY.DEAD],
  )}   declared-but-unimplemented shape`,
);
console.log(
  `docs promise something that does not exist ....... ${pad(counts.phantoms)}${
    counts.phantoms === 0 ? '   ✅ zero-tolerance class' : '   ❌ must be 0'
  }`,
);
console.log(
  `emitted for real but missing from the registry ... ${pad(
    counts.unregisteredEvents,
  )}   library defect — ratcheted, see the report`,
);
console.log(
  `advisory: prose names a non-existent import path . ${pad(
    counts.advisories,
  )}   needs human triage — never fails`,
);
console.log(
  `doc text that contradicts the code ............... ${pad(counts.docTextViolations)}${
    counts.docTextViolations === 0
      ? '   ✅ zero-tolerance class'
      : '   ❌ must be 0 — targeted rules, see below'
  }`,
);
console.log('');

if (JSON_OUT) {
  writeFileSync(
    resolve(ROOT, JSON_OUT),
    JSON.stringify(
      {
        counts,
        rows: result.rows,
        events: result.eventRows,
        phantoms: result.phantoms,
        unregisteredEvents: result.unregisteredEvents,
        advisories: result.advisories,
        docTextViolations: result.docText,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${JSON_OUT}`);
}

if (UPDATE_BASELINE) {
  mkdirSync(DATA_DIR, { recursive: true });
  const previous = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : null;
  const baseline = buildBaseline(result, surface, events, exercised);
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  writeFileSync(REPORT_PATH, buildReport(result, surface, events, exercised, docs, baseline));
  console.log(`baseline written → ${relative(ROOT, BASELINE_PATH)}`);
  console.log(`report written  → ${relative(ROOT, REPORT_PATH)}`);
  if (previous) {
    console.log(
      `undocumented exports: ${previous.undocumentedSymbols?.length ?? 0} → ${
        baseline.undocumentedSymbols.length
      }`,
    );
  }
  if (counts.phantoms > 0 || counts.docTextViolations > 0) {
    console.log('');
    console.log('NOTE: re-baselining does NOT excuse the "docs promise something that does not');
    console.log('exist" class, nor the "doc text contradicts the code" rules. Neither is ever');
    console.log('baselined and both still fail. Fix those first.');
    process.exit(1);
  }
  process.exit(0);
}

// ── Ratchet ──
if (!existsSync(BASELINE_PATH)) {
  console.error(`docs-truth: no baseline at ${relative(ROOT, BASELINE_PATH)}.`);
  console.error('Record one with: npm run docs:truth:baseline');
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const now = tracked(result);
const baseSymbols = new Set(baseline.undocumentedSymbols ?? []);
const baseEvents = new Set(baseline.undocumentedEvents ?? []);
const baseUnregistered = new Set(baseline.unregisteredEmittedEvents ?? []);
const newSymbols = now.undocumentedSymbols.filter((n) => !baseSymbols.has(n));
const newEvents = now.undocumentedEvents.filter((n) => !baseEvents.has(n));
const newUnregistered = now.unregisteredEmittedEvents.filter((n) => !baseUnregistered.has(n));
const nowSymbolSet = new Set(now.undocumentedSymbols);
const nowEventSet = new Set(now.undocumentedEvents);
const fixedSymbols = [...baseSymbols].filter((n) => !nowSymbolSet.has(n));
const fixedEvents = [...baseEvents].filter((n) => !nowEventSet.has(n));

let failed = false;

if (result.phantoms.length > 0) {
  failed = true;
  console.log('❌ THE PUBLISHED DOCS PROMISE SOMETHING THAT DOES NOT EXIST');
  console.log('');
  console.log('   This class is never baselined. A reader copies the line and it fails, so there');
  console.log('   must be zero of them. Fix the doc (or export the symbol):');
  console.log('');
  for (const p of result.phantoms) {
    console.log(`   • [${p.kind}] ${p.detail}`);
    console.log(`     ${p.page}`);
  }
  console.log('');
}

if (result.docText.length > 0) {
  failed = true;
  console.log(`❌ ${result.docText.length} DOC-TEXT LINE(S) THAT CONTRADICT THE CODE`);
  console.log('');
  console.log('   Sentence-level, not name-level: the symbol exists and is documented, but the');
  console.log('   words about it are wrong. Doc comments ship inside the emitted .d.ts, so a');
  console.log('   wrong sentence is what a consumer reads on hover. Never baselined — the');
  console.log('   steady state of every rule here is zero by construction.');
  console.log('');
  let lastRule = null;
  for (const f of result.docText) {
    if (f.rule !== lastRule) {
      lastRule = f.rule;
      console.log(`   [${f.rule}] ${f.headline}`);
      console.log(`     why: ${f.why}`);
      console.log(`     fix: ${f.fix}`);
    }
    console.log(`   • ${f.file}:${f.line} — ${f.detail}`);
    console.log(`     ${f.text.length > 100 ? f.text.slice(0, 100) + '…' : f.text}`);
  }
  console.log('');
  console.log('   A rule that is genuinely wrong should be EDITED (DOC_TEXT_RULES in');
  console.log('   scripts/docs-truth-check.mjs), not suppressed from the source: a suppression');
  console.log('   marker inside a doc comment would ship in the published .d.ts.');
  console.log('');
}

if (newSymbols.length > 0) {
  failed = true;
  console.log(`❌ ${newSymbols.length} NEW UNDOCUMENTED EXPORT(S) since the baseline`);
  console.log('');
  console.log('   These are exported but described in no prose on any hand-written page under');
  console.log('   docs-next/content/docs:');
  console.log('');
  for (const n of newSymbols) {
    const row = result.rows.find((r) => r.name === n);
    console.log(
      `   • ${n} (${row?.kind}) — exported from ${row?.subpaths.join(', ')}${
        row?.documented === 'site-code-only'
          ? ' — appears in a code sample only'
          : row?.documented === 'repo-only'
          ? ' — written up in ' + row.repoPages.join(', ') + ' but not on the site'
          : ''
      }`,
    );
  }
  console.log('');
}

if (newEvents.length > 0) {
  failed = true;
  console.log(`❌ ${newEvents.length} NEW UNDOCUMENTED EVENT(S) since the baseline`);
  console.log('');
  for (const n of newEvents) console.log(`   • ${n}`);
  console.log('');
}

if (newUnregistered.length > 0) {
  failed = true;
  console.log(
    `❌ ${newUnregistered.length} NEW EVENT(S) EMITTED BY src BUT MISSING FROM THE TYPED REGISTRY`,
  );
  console.log('');
  console.log('   The docs describe them and the code fires them, but they are not in');
  console.log('   ALL_EVENT_TYPES — so there is no payload type, no domain wildcard, and a');
  console.log('   consumer cannot subscribe in TypeScript. Register the event, or stop');
  console.log('   emitting a name that is not part of the contract:');
  console.log('');
  for (const n of newUnregistered) {
    const p = result.unregisteredEvents.find((x) => x.symbol === n);
    console.log(`   • ${n} — emitted at ${p?.emitter}, documented in ${p?.page}`);
  }
  console.log('');
}

if (failed) {
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log('WHAT TO DO');
  console.log('');
  console.log("This check is a RATCHET, not a gate. It does not ask you to fix the repo's");
  console.log('pre-existing gaps — those are recorded in docs/docs-truth/baseline.json and pass');
  console.log('happily. It fails only when the gap gets BIGGER, or when the docs point a reader');
  console.log('at something that does not exist.');
  console.log('');
  console.log('  1. "docs promise something that does not exist" → always fix the docs. This');
  console.log('     class is never baselined; there is no way to accept it.');
  console.log('  2. "doc text contradicts the code" → fix the sentence (each finding names the');
  console.log('     file, the line and the correct wording). Also never baselined.');
  console.log('  3. "new undocumented export/event" → EITHER describe it in prose on a page');
  console.log('     under docs-next/content/docs (one sentence naming it satisfies this check;');
  console.log('     a real write-up is better), OR, if it is deliberately undocumented for now,');
  console.log('     accept it consciously:');
  console.log('');
  console.log('         npm run docs:truth:baseline');
  console.log('');
  console.log('     That re-records the baseline and regenerates docs/DOCS_TRUTH_REPORT.md, so');
  console.log('     the new debt lands as a reviewable diff instead of disappearing quietly.');
  console.log('');
  console.log(`Full picture: docs/DOCS_TRUTH_REPORT.md (recorded ${baseline.recordedAt})`);
  process.exit(1);
}

console.log('✅ no regression against the baseline.');
console.log(
  `   baseline (${baseline.recordedAt}): ${
    baseline.undocumentedSymbols?.length ?? 0
  } undocumented exports, ${
    baseline.undocumentedEvents?.length ?? 0
  } undocumented events — known debt, deliberately not a failure.`,
);
if (fixedSymbols.length > 0 || fixedEvents.length > 0) {
  console.log('');
  console.log(
    `🎉 ${fixedSymbols.length} export(s) and ${fixedEvents.length} event(s) became documented since the baseline.`,
  );
  console.log('   Lock the improvement in so it cannot regress:  npm run docs:truth:baseline');
}
process.exit(0);
