import { expect, it } from 'vitest';
import { managedPagination } from './conformance/managedFixtures.js';
import { verifyDefaultRequestLimits } from './conformance/requestLimits.js';

function memoryBankFixture() {
  const harness = managedPagination.find((item) => item.name.startsWith('MemoryBankStore'));
  if (!harness) throw new Error('Missing fixture');
  return harness;
}

it('checks default limits under a controlled clock and restores the advancing host clock', async () => {
  const original = Date.now;
  let now = 1_792_453_156_876;
  const ticking = () => now++;
  Date.now = ticking;
  try {
    await verifyDefaultRequestLimits(memoryBankFixture());
    expect(Date.now).toBe(ticking);
  } finally {
    Date.now = original;
  }
});

it('restores the clock when opening the fixture fails', async () => {
  const original = Date.now;
  const failure = new Error('fixture unavailable');
  try {
    await expect(
      verifyDefaultRequestLimits({
        ...memoryBankFixture(),
        create: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(Date.now).toBe(original);
  } finally {
    Date.now = original;
  }
});

it('restores the clock when closing the fixture fails', async () => {
  const original = Date.now;
  const failure = new Error('fixture cleanup failed');
  const harness = memoryBankFixture();
  try {
    await expect(
      verifyDefaultRequestLimits({
        ...harness,
        create: async () => ({
          ...(await harness.create()),
          close: () => {
            throw failure;
          },
        }),
      }),
    ).rejects.toBe(failure);
    expect(Date.now).toBe(original);
  } finally {
    Date.now = original;
  }
});
