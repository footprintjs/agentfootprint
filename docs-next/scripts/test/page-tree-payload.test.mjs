import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loader, llms } from 'fumadocs-core/source';
import { searchPath } from 'fumadocs-core/breadcrumb';

// Exercise the real dependency option: source refs are private file lookup
// metadata. The docs layout needs names, URLs, stable IDs, roots and descriptions.
const files = [
  {
    type: 'meta',
    path: 'meta.json',
    data: { title: 'Docs', description: 'A handbook.', pages: ['index', 'guides', 'api'] },
  },
  { type: 'page', path: 'index.mdx', data: { title: 'Welcome', description: 'Start here.' } },
  {
    type: 'meta',
    path: 'guides/meta.json',
    data: { title: 'Guides', description: 'How to use it.', pages: ['first', 'second'] },
  },
  {
    type: 'page',
    path: 'guides/first.mdx',
    data: { title: 'First guide', description: 'First steps.' },
  },
  {
    type: 'page',
    path: 'guides/second.mdx',
    data: { title: 'Second guide', description: 'Next steps.' },
  },
  {
    type: 'meta',
    path: 'api/meta.json',
    data: { title: 'API Reference', root: true, pages: ['index', 'operation'] },
  },
  {
    type: 'page',
    path: 'api/index.md',
    data: { title: 'API', description: 'All public operations.' },
  },
  {
    type: 'page',
    path: 'api/operation.md',
    data: { title: 'Operation', description: 'Run an operation.' },
  },
];
const full = loader({ baseUrl: '/docs', source: { files: structuredClone(files) } });
const compact = loader({
  baseUrl: '/docs',
  source: { files: structuredClone(files) },
  pageTree: { noRef: true },
});

function withoutRefs(value) {
  if (Array.isArray(value)) return value.map(withoutRefs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$ref')
        .map(([key, child]) => [key, withoutRefs(child)]),
    );
  }
  return value;
}
const serialized = (value) => JSON.stringify(value);

test('compact navigation omits source paths and preserves every public tree field', () => {
  const before = full.getPageTree();
  const after = compact.getPageTree();
  assert.match(serialized(before), /"\$ref":/);
  assert.doesNotMatch(serialized(after), /"\$ref":/);
  assert.equal(serialized(after), serialized(withoutRefs(before)));
  assert.ok(Buffer.byteLength(serialized(after)) < Buffer.byteLength(serialized(before)));
  for (const page of full.getPages()) {
    assert.equal(
      serialized(searchPath(after.children, page.url)),
      serialized(withoutRefs(searchPath(before.children, page.url))),
    );
  }
});

test('page content, search inputs, machine index and relative links keep their source lookup', () => {
  assert.deepEqual(compact.getPages(), full.getPages());
  assert.deepEqual(compact.generateParams(), full.generateParams());
  assert.equal(llms(compact).index(), llms(full).index());
  const page = compact.getPage(['guides', 'first']);
  assert.ok(page);
  assert.equal(compact.resolveHref('./second.mdx#steps', page), '/docs/guides/second#steps');
  assert.equal(compact.resolveHref('../api/operation.md', page), '/docs/api/operation');
});
