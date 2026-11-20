import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSearchAPI } from 'fumadocs-core/search/server';
import { compactGuideIndex } from '../../lib/search-index-content.mjs';

test('a guide keeps its description, headings, and body in one searchable text record', async () => {
  const url = '/docs/guide';
  const index = compactGuideIndex({
    id: url,
    url,
    title: 'Moray',
    description: 'The kelp forest',
    structuredData: {
      headings: [{ id: 'cuttlefish', content: 'Cuttlefish' }],
      contents: [{ heading: 'cuttlefish', content: 'Camouflage changes quickly.' }],
    },
  });
  const api = createSearchAPI('advanced', { language: 'english', indexes: [index] });
  const response = await api.staticGET();
  const records = Object.values((await response.json()).docs.docs);
  assert.deepEqual(
    records.map((record) => [record.type, record.content]),
    [
      ['page', 'Moray'],
      ['text', 'The kelp forest\n\nCuttlefish\n\nCamouflage changes quickly.'],
    ],
  );

  for (const term of ['moray', 'kelp', 'cuttlefish', 'camouflage']) {
    const matches = await api.search(term);
    assert.ok(matches.some((result) => result.type === 'page' && result.url === url), term);
  }
});
