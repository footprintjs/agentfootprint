import { expect, it, vi } from 'vitest';
import { run } from '../../../examples/features/110-negative-claims.js';

it('the public mock example delivers its library statement and keeps the source gap', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const answer = await run('Check open incidents for payments.');
    expect(answer).toContain('incidents filed by email');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[record-composed]'));
  } finally {
    log.mockRestore();
  }
});
