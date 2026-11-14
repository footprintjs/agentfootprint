import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps the contributor entry guide within 200 lines', () => {
  const text = readFileSync(resolve(__dirname, '../../CLAUDE.md'), 'utf8');
  expect(
    text.replace(/\r?\n$/, '').split(/\r?\n/).length,
    'Move detail to the scoped rule or local README',
  ).toBeLessThanOrEqual(200);
});

it('uses file and symbol references instead of source line numbers', () => {
  const text = readFileSync(resolve(__dirname, '../../CLAUDE.md'), 'utf8');
  expect(text.match(/\.(?:ts|mjs|cjs):\d+/g) ?? []).toEqual([]);
});

it('loads each relocated module contract for the source folder it describes', () => {
  const rules = resolve(__dirname, '../../.claude/rules');
  for (const name of readdirSync(rules).filter((file) => file.endsWith('.md'))) {
    const text = readFileSync(resolve(rules, name), 'utf8');
    const frontmatter = text.split('---')[1] ?? '';
    const paths = [...frontmatter.matchAll(/^ {2}- ["']?([^\n"']+)["']?$/gm)].map(
      ([, path]) => path,
    );
    for (const [, folder] of text.matchAll(/^## Module contract: (.+\/)$/gm)) {
      expect(
        paths.some((path) => path.endsWith('/**') && `src/${folder}`.startsWith(path.slice(0, -2))),
        `${name} must load when working in src/${folder}`,
      ).toBe(true);
    }
  }
});
