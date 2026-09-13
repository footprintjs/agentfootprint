import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightHast } from 'fumadocs-core/highlight/shiki';
import { defaultShikiFactory } from 'fumadocs-core/highlight/shiki/full';
import { browserShikiFactory } from '../../lib/browser-highlighter';

const themes = { light: 'github-light', dark: 'github-dark' };
const textOf = (node: any): string => node.type === 'text'
  ? node.value
  : (node.children ?? []).map(textOf).join('');

test('browser omits non-web grammars while the server keeps its full catalog', async () => {
  const [browser, server] = await Promise.all([
    browserShikiFactory.getOrInit(), defaultShikiFactory.getOrInit(),
  ]);
  assert.equal('abap' in browser.getBundledLanguages(), false);
  assert.equal('abap' in server.getBundledLanguages(), true);
});

test('CodeFile languages keep highlighted tokens and exact source text', async () => {
  const highlighter = await browserShikiFactory.getOrInit();
  const samples = {
    ts: 'const year: number = 2026;',
    tsx: 'const view = <div>Hello</div>;',
    js: 'const year = 2026;',
    json: '{"year": 2026}',
    python: 'year = 2026',
  };
  for (const [lang, code] of Object.entries(samples)) {
    const tree = await highlightHast(highlighter, code, { lang, themes });
    assert.equal(textOf(tree), code, lang);
    assert.match(JSON.stringify(tree), /--shiki-dark/, lang);
  }
});

test('plain text and an unknown client grammar remain readable without loading it', async () => {
  const highlighter = await browserShikiFactory.getOrInit();
  const code = '  example <value>\n    keep this spacing';
  const plain = await highlightHast(highlighter, code, { lang: 'text', themes });
  const unknown = await highlightHast(highlighter, code, { lang: 'not-a-language', themes });
  const omitted = await highlightHast(highlighter, code, { lang: 'abap', themes });
  assert.equal(textOf(plain), code);
  assert.deepEqual(unknown, plain);
  assert.deepEqual(omitted, plain);
});
