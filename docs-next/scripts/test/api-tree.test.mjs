import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loader } from 'fumadocs-core/source';
import { searchPath } from 'fumadocs-core/breadcrumb';
import { splitApiTree } from '../../lib/api-tree.mjs';

// The shape gen-fumadocs-api.mjs writes: an API root with kind folders, each
// holding an index page and one page per symbol.
const symbols = ['Agent', 'AgentBuilder', 'LLMCall'];
const files = [
  { type: 'meta', path: 'meta.json', data: { title: 'Docs', pages: ['index', 'guides', 'api'] } },
  { type: 'page', path: 'index.mdx', data: { title: 'Welcome' } },
  { type: 'meta', path: 'guides/meta.json', data: { title: 'Guides', pages: ['first'] } },
  { type: 'page', path: 'guides/first.mdx', data: { title: 'First guide' } },
  {
    type: 'meta',
    path: 'api/meta.json',
    data: { title: 'API Reference', root: true, pages: ['index', '...'] },
  },
  { type: 'page', path: 'api/index.md', data: { title: 'API' } },
  { type: 'meta', path: 'api/classes/meta.json', data: { title: 'Classes', pages: ['...'] } },
  { type: 'page', path: 'api/classes/index.md', data: { title: 'Classes' } },
  ...symbols.map((name) => ({
    type: 'page',
    path: `api/classes/${name}.md`,
    data: { title: name },
  })),
];
const source = loader({ baseUrl: '/docs', source: { files }, pageTree: { noRef: true } });
const full = source.getPageTree();
const { guideTree, apiTree } = splitApiTree(full);
const json = (v) => JSON.stringify(v);

test('no symbol page is serialized into either tree', () => {
  assert.match(json(full), /\/docs\/api\/classes\/Agent"/);
  for (const tree of [guideTree, apiTree]) {
    for (const name of symbols) assert.doesNotMatch(json(tree), new RegExp(`/classes/${name}"`));
    assert.equal(tree.fallback, undefined);
  }
});

test('guide pages keep their place in the guide tree', () => {
  for (const url of ['/docs', '/docs/guides/first']) {
    assert.equal(json(searchPath(guideTree.children, url)), json(searchPath(full.children, url)));
  }
});

test('the API tree keeps the landing page and every kind index', () => {
  assert.ok(searchPath(apiTree.children, '/docs/api'));
  const kind = apiTree.children.find((c) => c.url === '/docs/api/classes');
  assert.equal(kind.type, 'page', 'a kind is a plain link to its index page');
  assert.ok(searchPath(apiTree.children, '/docs/api/classes'));
});

test('every symbol page still has a route', () => {
  const urls = source.getPages().map((p) => p.url);
  for (const name of symbols) assert.ok(urls.includes(`/docs/api/classes/${name}`));
});

test('a tree without an API root is returned unchanged, minus the fallback', () => {
  const plain = { type: 'root', name: 'Docs', children: full.children.slice(0, 1), fallback: {} };
  const out = splitApiTree(plain);
  assert.equal(out.apiTree, undefined);
  assert.equal(out.guideTree.fallback, undefined);
  assert.deepEqual(out.guideTree.children, plain.children);
});

test('the real shape: an API root the top-level meta.json does not list (fallback)', () => {
  const unlisted = files.map((f) =>
    f.path === 'meta.json' ? { ...f, data: { ...f.data, pages: ['index', 'guides'] } } : f,
  );
  const src = loader({ baseUrl: '/docs', source: { files: unlisted }, pageTree: { noRef: true } });
  const tree = src.getPageTree();
  assert.ok(tree.fallback, 'fumadocs files the unlisted API folder under fallback');
  const split = splitApiTree(tree);
  assert.ok(split.apiTree, 'the API tree is found in the fallback');
  assert.ok(searchPath(split.apiTree.children, '/docs/api'));
  assert.equal(split.guideTree.fallback, undefined);
  for (const name of symbols) {
    assert.doesNotMatch(json(split.guideTree), new RegExp(`/classes/${name}"`));
    assert.doesNotMatch(json(split.apiTree), new RegExp(`/classes/${name}"`));
  }
});

test('a guide folder that links to the API landing page is not taken for the API root', () => {
  const overrides = {
    'meta.json': { title: 'Docs', pages: ['index', 'guides'] },
    'guides/meta.json': { title: 'Guides', pages: ['first', '[API Reference](/docs/api)'] },
  };
  const withLink = files.map((f) => (f.path in overrides ? { ...f, data: overrides[f.path] } : f));
  const src = loader({ baseUrl: '/docs', source: { files: withLink }, pageTree: { noRef: true } });
  const tree = src.getPageTree();
  const guides = tree.children.find((c) => c.type === 'folder' && c.name === 'Guides');
  assert.ok(
    guides.children.some((c) => c.type === 'page' && c.url === '/docs/api'),
    'the guide folder really links to the API landing page',
  );
  const split = splitApiTree(tree);
  assert.equal(split.apiTree.name, 'API Reference');
  assert.ok(split.apiTree.children.some((c) => c.url === '/docs/api/classes'));
});
