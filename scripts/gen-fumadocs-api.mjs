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
import { API_GROUPS, groupApiPages, resolveApiAlias } from '../docs-next/lib/api-groups.mjs';
import { normalizeDependencySources } from './doc-source-links.mjs';

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
    md = normalizeDependencySources(md);
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

// Render related event payloads together. Their old URLs are small export aliases,
// not sixteen additional React routes carrying the same layout and navigation.
const originalPages = new Map();
function collectPages(dir) {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) collectPages(file);
    else if (entry.endsWith('.md')) originalPages.set(path.relative(OUT, file).replaceAll('\\', '/'), readFileSync(file, 'utf8'));
  }
}
collectPages(OUT);
const grouped = groupApiPages(originalPages);
for (const key of originalPages.keys()) if (!grouped.pages.has(key)) rmSync(join(OUT, key));
for (const [key, content] of grouped.pages) writeFileSync(join(OUT, key), content);
writeFileSync(join(ROOT, 'docs-next/lib/generated-api-aliases.json'), JSON.stringify(grouped.aliases, null, 2) + '\n');

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
// 5. one index page per kind folder. The sidebar lists ONLY these (the site's
// layout trims the symbol pages out of the navigation tree — lib/api-tree.mjs),
// because the tree is serialized into every page of the static export: listing
// all ~680 symbols there made every page ~1 MB. Each symbol stays reachable
// here, by search, and at its unchanged URL.
for (const [folder, title] of Object.entries(FOLDER_TITLES)) {
  const fdir = join(OUT, folder);
  if (existsSync(fdir)) {
    writeFileSync(
      join(fdir, 'meta.json'),
      JSON.stringify({ title, pages: ['...'] }, null, 2) + '\n',
    );
    const entries = readdirSync(fdir)
      .filter((f) => f.endsWith('.md') && f !== 'index.md' && !API_GROUPS.some((group) => f === `${group.slug}.md`))
      .map((f) => {
        const base = f.replace(/\.md$/, '');
        const title = readFileSync(join(fdir, f), 'utf8').match(/^title:\s*(.+)$/m)?.[1] ?? '';
        const deprecated = title.includes('~~');
        return { name: base, deprecated, href: `/docs/api/${folder}/${base}` };
      })
      .concat(folder === 'interfaces' ? grouped.aliases.map((alias) => ({ name: alias.anchor, deprecated: false, href: resolveApiAlias(alias.from, grouped.aliases) })) : [])
      .sort((a, b) => a.name.localeCompare(b.name));
    const list = entries
      .map((e) => `- [\`${e.name}\`](${e.href})${e.deprecated ? ' — deprecated' : ''}`)
      .join('\n');
    writeFileSync(
      join(fdir, 'index.md'),
      `---\ntitle: ${title}\n---\n\n${entries.length} exported from \`agentfootprint\`.\n\n${folder === 'interfaces' ? API_GROUPS.map((group) => `[${group.title}](/docs/api/interfaces/${group.slug})`).join(' · ') + '\n\n' : ''}${list}\n`,
    );
  }
}

console.log(`[api] done → ${path.relative(ROOT, OUT)}`);
