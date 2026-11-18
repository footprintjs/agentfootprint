import { describe, expect, it, vi } from 'vitest';

import type { Ending } from '../../terminate.js';
import type { PooledClient } from '../pooledClient.js';
import { closeLocally, endingOnly } from './endings.js';

describe('the end-only port', () => {
  it('forwards the original ending and receiver, while refusing unsupported operations', async () => {
    const ending: Ending = {
      outcome: Promise.resolve({ remote: 'no-session', resolved: true, durationMs: 0 }),
      settled: Promise.resolve(),
    };
    const halfOpen = {
      end: vi.fn(function (this: unknown) {
        expect(this).toBe(halfOpen);
        return ending;
      }),
    };
    const port = endingOnly(halfOpen);

    expect(port.end()).toBe(ending);
    expect(halfOpen.end).toHaveBeenCalledOnce();
    expect(() => port.bind({ name: 'unsupported', inputSchema: { type: 'object' } })).toThrow(
      'This client never opened.',
    );
    let listing: ReturnType<typeof port.listing> | undefined;
    expect(() => {
      listing = port.listing(undefined);
    }).not.toThrow();
    await expect(listing).rejects.toThrow('This client never opened.');
  });
});

describe('local-close settlement', () => {
  it('answers unresolved before a delayed close settles and starts close only in a microtask', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const close = vi.fn(() => pending);
    const client = { client: { close } } as unknown as PooledClient;
    const ending = closeLocally(client);
    let settled = false;
    void ending.settled.then(() => {
      settled = true;
    });

    expect(close).not.toHaveBeenCalled();
    await expect(ending.outcome).resolves.toEqual({
      remote: 'handle-lost',
      resolved: false,
      durationMs: 0,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    release();
    await ending.settled;
    expect(settled).toBe(true);
  });

  it('settles a rejected local close without rewriting its unresolved outcome', async () => {
    const close = vi.fn(() => Promise.reject(new Error('close rejected')));
    const ending = closeLocally({ client: { close } } as unknown as PooledClient);

    await expect(ending.settled).resolves.toBeUndefined();
    await expect(ending.outcome).resolves.toMatchObject({ remote: 'handle-lost', resolved: false });
    expect(close).toHaveBeenCalledOnce();
  });

  it('defers a synchronously throwing close and contains its rejection', async () => {
    const close = vi.fn(() => {
      throw new Error('close threw');
    });
    const ending = closeLocally({ client: { close } } as unknown as PooledClient);

    expect(close).not.toHaveBeenCalled();
    await expect(ending.settled).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it('settles when there is no local client, with an unresolved remote outcome', async () => {
    const ending = closeLocally({ client: undefined } as PooledClient);

    await expect(ending.settled).resolves.toBeUndefined();
    await expect(ending.outcome).resolves.toEqual({
      remote: 'handle-lost',
      resolved: false,
      durationMs: 0,
    });
  });
});
