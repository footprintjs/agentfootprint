/** Small static aliases preserve bookmarks without rebuilding a React page per old symbol. */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateApiAlias } from '../lib/api-groups.mjs';

const html = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const json = (value) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

export function redirectHtml(alias, basePath = '') {
  validateApiAlias(alias);
  if (!/^(?:\/[A-Za-z0-9_-]+)*$/.test(basePath)) throw new Error('Invalid docs base path');
  const target = basePath + alias.to;
  const fallback = target + '#' + encodeURIComponent(alias.target);
  const data = { to: target, anchor: alias.target, fragments: alias.fragments };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${html(
    alias.anchor,
  )} — API reference moved</title><link rel="canonical" href="${html(
    fallback,
  )}"><script>const a=${json(
    data,
  )};let h;try{h=decodeURIComponent(location.hash.slice(1))}catch{h=''}const k=Object.hasOwn(a.fragments,h)?a.fragments[h]:a.anchor;location.replace(a.to+'#'+encodeURIComponent(k));</script><noscript><meta http-equiv="refresh" content="0;url=${html(
    fallback,
  )}"></noscript></head><body><p>This API reference moved to <a href="${html(fallback)}">${html(
    alias.anchor,
  )}</a>.</p></body></html>`;
}

function checkWithin(root, filename) {
  const rel = relative(root, filename);
  if (rel.startsWith('..') || rel.startsWith('/')) throw new Error('Invalid API alias path');
  let parent = root;
  for (const part of rel.split('/').slice(0, -1)) {
    parent = join(parent, part);
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink())
      throw new Error('API alias symlink refused');
  }
  if (existsSync(filename) && lstatSync(filename).isSymbolicLink())
    throw new Error('API alias symlink refused');
}

function writeWithin(root, filename, content) {
  checkWithin(root, filename);
  mkdirSync(dirname(filename), { recursive: true });
  if (existsSync(filename)) {
    if (lstatSync(filename).isSymbolicLink() || readFileSync(filename, 'utf8') !== content)
      throw new Error('API alias output collision');
    return;
  }
  writeFileSync(filename, content, { flag: 'wx' });
}

export function writeApiRedirects(output, aliases, basePath = '') {
  const root = resolve(output);
  if (!existsSync(root)) return 0; // A non-export dev/server build has no output tree.
  if (lstatSync(root).isSymbolicLink()) throw new Error('API alias output symlink refused');
  if (!Array.isArray(aliases) || aliases.length > 64) throw new Error('Invalid API alias list');
  // Validate every destination before writing anything.
  const renderedAnchors = new Map();
  const entries = aliases.map((alias) => {
    const page = redirectHtml(alias, basePath);
    if (typeof alias.markdown !== 'string' || alias.markdown.length > 1_000_000)
      throw new Error('Invalid API alias Markdown');
    if (!renderedAnchors.has(alias.to)) {
      const file = join(root, alias.to, 'index.html');
      checkWithin(root, file);
      if (!existsSync(file)) throw new Error('API alias canonical page missing');
      renderedAnchors.set(
        alias.to,
        new Set(
          [...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]),
        ),
      );
    }
    const anchors = renderedAnchors.get(alias.to);
    if ([alias.target, ...Object.values(alias.fragments)].some((id) => !anchors.has(id)))
      throw new Error('API alias rendered anchor missing');
    return { alias, page };
  });
  for (const { alias, page } of entries) {
    writeWithin(root, join(root, alias.from, 'index.html'), page);
    writeWithin(root, join(root, 'llms.mdx', alias.from), alias.markdown);
  }
  return entries.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const aliases = JSON.parse(
    readFileSync(new URL('../lib/generated-api-aliases.json', import.meta.url), 'utf8'),
  );
  const count = writeApiRedirects(
    process.argv[2] ?? 'out',
    aliases,
    process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  );
  console.log(`API aliases: ${count} lightweight HTML and individual Markdown bookmarks retained.`);
}
