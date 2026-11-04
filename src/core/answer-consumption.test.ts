import { expect, it, vi } from 'vitest';
import { AnswerConsumption } from './answerConsumption.js';
import { spendDecision } from './consentRequest.js';
import type { DecisionLedger } from './consentRequest.js';
import type { CheckInDecision } from './checkin.js';

const decision = { requestId: 'request', approved: true, by: 'person' } as CheckInDecision;
it.each(['before', 'refused', 'unknown', 'during'] as const)(
  'keeps confirmed consumption separate from cancellation and refusal: %s',
  async (shape) => {
    const receipt = new AnswerConsumption(),
      controller = new AbortController();
    const cancellation = new Error('caller left');
    const spend = vi.fn(async () => {
      if (shape === 'refused') return false;
      if (shape === 'unknown') throw new Error('ledger unavailable');
      controller.abort(cancellation);
      return true;
    });
    const ledger = { spend, isSpent: () => false } as unknown as DecisionLedger;
    if (shape === 'before') controller.abort(cancellation);
    await expect(
      spendDecision(ledger, decision, 'checkIn', controller.signal, receipt),
    ).rejects.toBeInstanceOf(Error);
    expect(receipt.consumed).toBe(shape === 'during');
    expect(spend).toHaveBeenCalledTimes(shape === 'before' ? 0 : 1);
  },
);

it('a late confirmed ledger result updates only its detached receipt and preserves cancellation', async () => {
  const receipt = new AnswerConsumption(),
    controller = new AbortController();
  let finish!: (fresh: boolean) => void;
  const ledger = {
    spend: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  } as unknown as DecisionLedger;
  const cancellation = new Error('caller left');
  const attempt = spendDecision(ledger, decision, 'checkIn', controller.signal, receipt);
  controller.abort(cancellation);
  // Native ownership may already have retired here; receipt has no live capabilities.
  expect(receipt.consumed).toBe(false);
  const successor = new AnswerConsumption();
  finish(true);
  await expect(attempt).rejects.toBe(cancellation);
  expect(receipt.consumed).toBe(true);
  expect(successor.consumed).toBe(false);
});
