import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSearchAPI } from 'fumadocs-core/search/server';
import { orderSearchIndexes } from '../../lib/search-index-order.mjs';

const page = (url, title, content) =>
  Object.freeze({
    id: url,
    url,
    title,
    structuredData: Object.freeze({
      headings: Object.freeze([]),
      contents: Object.freeze([Object.freeze({ content })]),
    }),
  });
const indexes = Object.freeze([
  page('/docs/zebra', 'Zebra', 'Searchable zebra records.'),
  page('/docs/Alpha', 'Alpha', 'Searchable alpha records.'),
  page('/#context', 'Context', 'Searchable context chapter.'),
  page('/docs/api/tool', 'Tool', 'Searchable API title.'),
  page('/docs/éclair', 'Éclair', 'Searchable unicode records.'),
]);
const permutations = [
  indexes,
  [...indexes].reverse(),
  [indexes[2], indexes[4], indexes[0], indexes[3], indexes[1]],
];

test('orders unique URLs by codepoint without mutating or replacing records', () => {
  const result = orderSearchIndexes(indexes);
  assert.deepEqual(
    result.map((item) => item.url),
    ['/#context', '/docs/Alpha', '/docs/api/tool', '/docs/zebra', '/docs/éclair'],
  );
  assert.notEqual(result, indexes);
  for (const item of result) assert.ok(indexes.includes(item));
  assert.deepEqual(
    indexes.map((item) => item.url),
    ['/docs/zebra', '/docs/Alpha', '/#context', '/docs/api/tool', '/docs/éclair'],
  );
  assert.deepEqual(orderSearchIndexes([]), []);
});

test('uses stable IDs when two unique records have the same URL', () => {
  const records = [
    { id: 'second', url: '/docs/shared' },
    { id: 'first', url: '/docs/shared' },
  ];
  assert.deepEqual(
    orderSearchIndexes(records).map((item) => item.id),
    ['first', 'second'],
  );
});

test('real static search export is byte-identical for discovery permutations', async () => {
  let expected;
  for (const permutation of permutations) {
    const api = createSearchAPI('advanced', {
      language: 'english',
      indexes: orderSearchIndexes(permutation),
    });
    const response = await api.staticGET();
    const bytes = await response.text();
    expected ??= bytes;
    assert.equal(bytes, expected);
    const records = Object.values(JSON.parse(bytes).docs.docs);
    for (const input of indexes) {
      assert.ok(
        records.some((record) => record.url === input.url && record.content === input.title),
      );
      assert.ok(
        records.some(
          (record) =>
            record.url === input.url && record.content === input.structuredData.contents[0].content,
        ),
      );
    }
  }
});
