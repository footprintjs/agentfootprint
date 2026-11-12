import { describe, expect, it } from 'vitest';
import { close } from './close.js';
import type { CloseCall } from '../../call.js';
import type { FirestoreLike } from '../../types.js';

function input(ownsClient: boolean, terminate: () => Promise<void>): CloseCall {
  return {
    failed: false,
    lifecycle: { closed: false },
    ownsClient,
    db: { terminate } as FirestoreLike,
  };
}

describe('client shutdown ownership', () => {
  it('marks a caller-owned client closed without terminating somebody else’s channels', async () => {
    let terminated = 0;
    const call = input(false, async () => {
      terminated++;
    });
    await close(call);
    await close(call);
    expect(call.lifecycle.closed).toBe(true);
    expect(terminated).toBe(0);
  });

  it('is final and idempotent even when termination fails', async () => {
    let terminated = 0;
    const call = input(true, async () => {
      terminated++;
      throw new Error('transport shutdown');
    });
    await expect(close(call)).resolves.toBeUndefined();
    await expect(close(call)).resolves.toBeUndefined();
    expect(call.lifecycle.closed).toBe(true);
    expect(terminated).toBe(1);
  });

  it('sets closed before terminating so reentry cannot close twice', async () => {
    let terminated = 0;
    const call = input(true, async () => {
      terminated++;
      expect(call.lifecycle.closed).toBe(true);
      await close(call);
    });
    await close(call);
    expect(terminated).toBe(1);
  });
});
