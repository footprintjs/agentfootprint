import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error The standalone benchmark is JavaScript, like the other benchmark doors.
import { BudgetLedger, requestBound, usageCost } from '../../../bench/negative/full/budget.mjs';
// @ts-expect-error The standalone benchmark is JavaScript.
import { budgetClient } from '../../../bench/negative/full/transport.mjs';

const dirs: string[] = [];
function ledger(cap = 4.3) {
  const dir = mkdtempSync(join(tmpdir(), 'negative-budget-'));
  dirs.push(dir);
  return new BudgetLedger(join(dir, 'ledger.jsonl'), cap);
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true })));
const model = 'claude-haiku-4-5-20251001';

describe('the total paid-run budget', () => {
  it('records a failed correction reservation even after the first response was paid', async () => {
    const l = ledger(0.01);
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'synthetic-test-key';
    const wire: Array<{ error?: string; phase?: string }> = [];
    try {
      const client = budgetClient({
        ledger: l,
        purpose: 'trial',
        onCall: (row: { error?: string; phase?: string }) => wire.push(row),
        fetchImpl: async (url: string) => {
          if (url.endsWith('count_tokens'))
            return { ok: true, json: async () => ({ input_tokens: 100 }) };
          return { ok: true, json: async () => ({ usage: { input_tokens: 1, output_tokens: 1 } }) };
        },
      });
      await client.messages.create({ model, max_tokens: 10, messages: [] });
      await expect(
        client.messages.create({ model, max_tokens: 4000, messages: [] }),
      ).rejects.toThrow('Budget stop');
      expect(wire).toHaveLength(2);
      expect(wire[1].phase).toBe('reserve');
      expect(wire[1].error).toContain('Budget stop');
      expect(l.summary().calls).toBe(1);
      expect(l.total()).toBe(6);
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });
  it('refuses a cap above the owner limit', () => {
    expect(() => ledger(4.31)).toThrow('$4.30');
  });
  it('charges cache creation and reads separately and rounds up', () => {
    expect(
      usageCost(model, {
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_input_tokens: 80,
        cache_read_input_tokens: 100,
      }),
    ).toBe(260);
    expect(usageCost('claude-haiku-5-5', { input_tokens: 1, output_tokens: 0 })).toBe(1);
    expect(() => usageCost(model, {})).toThrow('usage');
  });
  it('reserves concurrent requests before they finish, so both cannot spend the remainder', () => {
    const l = ledger(0.01);
    l.reserve('a', model, 6000, 'agent');
    expect(() => l.reserve('b', model, 6000, 'rater')).toThrow('Budget stop');
    l.settle('a', { input_tokens: 100, output_tokens: 0 });
    l.reserve('b', model, 6000, 'rater');
    expect(l.total()).toBe(6100);
  });
  it('persists unknown charges and crash reservations across restarts', () => {
    const l = ledger(0.01);
    l.reserve('a', model, 6000, 'agent');
    const restored = new BudgetLedger(l.path, 0.01);
    expect(restored.total()).toBe(6000);
    restored.uncertain('a');
    const again = new BudgetLedger(l.path, 0.01);
    expect(again.summary().uncertain).toBe(1);
    expect(() => again.reserve('b', model, 5000, 'retry')).toThrow('Budget stop');
    expect(() => again.reserve('a', model, 1, 'retry')).toThrow('reused');
  });
  it('requires complete usage and stops if the provider exceeds a reservation', () => {
    const l = ledger();
    l.reserve('a', model, 100, 'agent');
    expect(() => l.settle('a', { input_tokens: 0 })).toThrow();
    expect(l.total()).toBe(100);
    expect(() => l.settle('a', { input_tokens: 101, output_tokens: 0 })).toThrow('exceeded');
    expect(() => l.reserve('b', model, 1, 'agent')).toThrow('Budget stop');
  });
  it('bounds framing and cache writes, and rejects unknown model prices', () => {
    expect(requestBound(model, 1000, 384)).toBe(3490);
    expect(() => requestBound('unknown', 1, 1)).toThrow();
    expect(() => requestBound('claude-haiku-5-5', 100000, 384)).toThrow('tier');
  });
  it('fsyncs a reservation before transmission, with no automatic retry after a network error', async () => {
    const l = ledger();
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'synthetic-test-key';
    let sends = 0;
    try {
      const client = budgetClient({
        ledger: l,
        purpose: 'agent',
        fetchImpl: async (url: string) => {
          if (url.endsWith('count_tokens'))
            return { ok: true, json: async () => ({ input_tokens: 100 }) };
          sends += 1;
          expect(readFileSync(l.path, 'utf8')).toContain('reserve');
          throw new Error('connection lost after send');
        },
      });
      await expect(
        client.messages.create({ model, max_tokens: 384, messages: [] }),
      ).rejects.toThrow('connection lost');
      expect(sends).toBe(1);
      expect(l.summary().uncertain).toBe(1);
      expect(l.total()).toBe(requestBound(model, 100, 384));
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
