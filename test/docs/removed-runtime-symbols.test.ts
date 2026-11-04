import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { productionSources } from '../helpers/productionSources.js';

it('shipped runtime code and comments use the native lifecycle vocabulary', () => {
  const root = resolve(__dirname, '../..');
  const removed = /\b(?:openRunRedaction|makeRunId)\b/;
  const stale = productionSources(resolve(root, 'src')).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        removed.test(line) ? [`${relative(root, file)}:${index + 1}: ${line.trim()}`] : [],
      ),
  );
  expect(stale).toEqual([]);
});
