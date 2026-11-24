import { expect, it, vi } from 'vitest';
import { run } from '../../../examples/features/111-negative-prose-observe.js';

it('the prose mock example delivers the default warning for a native source gap', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(await run('Check incidents for payments.')).toBe(
      'There are no incidents for payments.\n\n---\n\nNot sure — a tool said there is ground it did not check or cannot cover (cannot cover “incidents filed by email” because “email reports never enter this store”); a tool said nothing matched; model prose was not verified for negative claims.',
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('coverage-gap'));
  } finally {
    log.mockRestore();
  }
});
