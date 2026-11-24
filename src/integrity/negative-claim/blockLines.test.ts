import { expect, it } from 'vitest';
import { blockLines } from './blockLines.js';

it('keeps the list container after a lazy line that starts with inline backticks', () => {
  const classify = blockLines();
  const ticks = '\x60\x60\x60';
  expect(classify('- Paragraph')).toEqual({ kind: 'prose', body: 'Paragraph' });
  expect(classify(ticks + 'example' + ticks)).toEqual({
    kind: 'prose',
    body: ticks + 'example' + ticks,
  });
  expect(classify('  ' + ticks + 'text')).toEqual({ kind: 'fence' });
  expect(classify('  sample')).toEqual({ kind: 'code' });
  expect(classify('  ' + ticks)).toEqual({ kind: 'fence' });
});

it('keeps a tilde fence with a backtick in its info string', () => {
  const classify = blockLines();
  expect(classify('~~~text \x60')).toEqual({ kind: 'fence' });
  expect(classify('sample')).toEqual({ kind: 'code' });
  expect(classify('~~~')).toEqual({ kind: 'fence' });
});
