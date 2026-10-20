import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { redirectHtml, writeApiRedirects } from '../../docs-next/scripts/api-redirects.mjs';

function renderedGroup(
  root: string,
  body = '<h2 id="interface-readevent"></h2><h3 id="value-6"></h3>',
) {
  const folder = join(root, 'docs/api/interfaces/scope-events');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'index.html'), body);
}

const alias = {
  from: '/docs/api/interfaces/ReadEvent',
  to: '/docs/api/interfaces/scope-events',
  anchor: 'ReadEvent',
  target: 'interface-readevent',
  fragments: { value: 'value-6' },
  markdown: '# ReadEvent\n\nOriginal declaration.\n',
};

describe('lightweight static API aliases', () => {
  it.each(['#value', '#unknown', '#__proto__', '#%ZZ', '#%3C/script%3E', ''])(
    'keeps %s within the fixed canonical destination',
    (hash) => {
      const text = redirectHtml(alias, '/reference');
      const script = text.match(/<script>([\s\S]*?)<\/script>/)![1];
      let target = '';
      runInNewContext(script, {
        location: {
          hash,
          replace: (url: string) => {
            target = url;
          },
        },
      });
      expect(target).toBe(
        `/reference/docs/api/interfaces/scope-events#${
          hash === '#value' ? 'value-6' : 'interface-readevent'
        }`,
      );
      expect(text).toContain('<noscript>');
      expect(text).toContain(
        'href="/reference/docs/api/interfaces/scope-events#interface-readevent"',
      );
      expect(text.length).toBeLessThan(1500);
    },
  );

  it.each([
    'https://outside.example',
    '//outside.example',
    '/docs/../outside',
    '/docs/api/interfaces/Other',
  ])('refuses destination %s', (to) => expect(() => redirectHtml({ ...alias, to })).toThrow());

  it('writes safe, repeatable HTML and the individual raw Markdown door', () => {
    const root = mkdtempSync(join(tmpdir(), 'af-doc-alias-'));
    try {
      renderedGroup(root);
      expect(writeApiRedirects(root, [alias])).toBe(1);
      expect(writeApiRedirects(root, [alias])).toBe(1);
      expect(readFileSync(join(root, alias.from, 'index.html'), 'utf8')).toBe(redirectHtml(alias));
      expect(readFileSync(join(root, 'llms.mdx', alias.from), 'utf8')).toBe(alias.markdown);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to publish a bookmark whose target was dropped by the Markdown renderer', () => {
    const root = mkdtempSync(join(tmpdir(), 'af-doc-target-'));
    try {
      renderedGroup(root, '<h2 id="interface-readevent"></h2>');
      expect(() => writeApiRedirects(root, [alias])).toThrow(/anchor/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a symlink or an existing route instead of overwriting unrelated files', () => {
    const root = mkdtempSync(join(tmpdir(), 'af-doc-alias-'));
    const outside = mkdtempSync(join(tmpdir(), 'af-doc-outside-'));
    try {
      renderedGroup(outside);
      symlinkSync(join(outside, 'docs'), join(root, 'docs'));
      expect(() => writeApiRedirects(root, [alias])).toThrow(/symlink/);
      rmSync(join(root, 'docs'));
      renderedGroup(root);
      const folder = join(root, alias.from);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'index.html'), 'real page');
      expect(() => writeApiRedirects(root, [alias])).toThrow(/collision/);
      expect(readFileSync(join(folder, 'index.html'), 'utf8')).toBe('real page');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
