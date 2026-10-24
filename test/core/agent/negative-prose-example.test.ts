import { expect, it, vi } from 'vitest';
import { run } from '../../../examples/features/111-negative-prose-observe.js';

it('the prose mock example observes a native source gap and delivers the unchanged answer', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(await run('Check incidents for payments.')).toBe('There are no incidents for payments.');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('coverage-gap'));
  } finally {
    log.mockRestore();
  }
});
