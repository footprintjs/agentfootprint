/**
 * Auto-generate the Fumadocs in-site API reference from TypeScript source via TypeDoc.
 *
 * ANTI-STALE CONTRACT: this script CLEANS and REGENERATES the API reference from
 * `src/` on every run, then post-processes the TypeDoc markdown to be Fumadocs-ready
 * (adds `title` frontmatter, rewrites internal links, writes sidebar meta.json).
 *
 * It runs as docs-next's `predev` / `prebuild`, so the published API reference is
 * ALWAYS rebuilt from the current source — a removed/renamed export can never leave
 * a stale page behind (the clean step deletes the old tree first).
 *
 * The generated `.md` files ARE committed (reviewable diff + the site builds without
 * re-running TypeDoc); CI re-runs this and `git diff --exit-code`s to enforce freshness.
 */
import { execFileSync } from 'node:child_process';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // agentfootprint/
const OUT = path.join(ROOT, 'docs-next', 'content', 'docs', 'api');

const FOLDER_TITLES = {
  classes: 'Classes',
  functions: 'Functions',
  interfaces: 'Interfaces',
  'type-aliases': 'Type Aliases',
  variables: 'Variables',
  enumerations: 'Enumerations',
  namespaces: 'Namespaces',
};

/** Strip TypeDoc's "Kind: Name()" H1 down to a clean sidebar/title string. */
function deriveTitle(md, fallback) {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  if (!m) return fallback;
  let t = m[1].replace(/\\/g, '').replace(/`/g, '');
  t = t.replace(
    /^(Class|Function|Interface|Type Alias|Variable|Enumeration|Enum|Namespace|Module)\s*:\s*/i,
    '',
  );
  t = t.replace(/\(\)$/, '');
  return t.trim() || fallback;
}

/** Make TypeDoc's absolute `/docs/api/...md` links Fumadocs-resolvable (no `.md`, collapse /index). */
function rewriteLinks(md) {
  // strip `.md` from internal (non-http) link targets, preserving an optional #hash
  md = md.replace(
    /\]\((?!https?:)([^)\s#]*?)\.md(#[^)]*)?\)/g,
    (_, p, hash = '') => `](${p}${hash || ''})`,
  );
  // collapse the entry-file link to the api root
  md = md.replace(
    /\]\(\/docs\/api\/index(#[^)]*)?\)/g,
    (_, hash = '') => `](/docs/api${hash || ''})`,
  );
  return md;
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fp = join(dir, entry);
    if (statSync(fp).isDirectory()) {
      walk(fp);
      continue;
    }
    if (!entry.endsWith('.md')) continue;
    let md = readFileSync(fp, 'utf8');
    const base = entry.replace(/\.md$/, '');
    const title = deriveTitle(md, base);
    md = rewriteLinks(md);
    const safeTitle = /[:#"'{}[\]]/.test(title) ? JSON.stringify(title) : title;
    md = `---\ntitle: ${safeTitle}\n---\n\n${md}`;
    writeFileSync(fp, md);
  }
}

// 1. clean (the anti-stale guarantee)
rmSync(OUT, { recursive: true, force: true });

// 2. regenerate from source
console.log('[api] running TypeDoc → Fumadocs markdown …');
// execFileSync (no shell) — static args, no interpolation.
execFileSync('node_modules/.bin/typedoc', ['--options', 'typedoc.docs-next.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});

// 3. Fumadocs-ify every page (frontmatter + links)
walk(OUT);

// 4. sidebar meta.json (root + per declaration-kind folder)
writeFileSync(
  join(OUT, 'meta.json'),
  JSON.stringify(
    {
      title: 'API Reference',
      // own sidebar tab (Fumadocs "root") — switcher: Docs | API Reference
      root: true,
      description: 'Auto-generated from TypeScript source.',
      pages: ['index', '...'],
    },
    null,
    2,
  ) + '\n',
);
for (const [folder, title] of Object.entries(FOLDER_TITLES)) {
  const fdir = join(OUT, folder);
  if (existsSync(fdir)) {
    writeFileSync(
      join(fdir, 'meta.json'),
      JSON.stringify({ title, pages: ['...'] }, null, 2) + '\n',
    );
  }
}

console.log(`[api] done → ${path.relative(ROOT, OUT)}`);
