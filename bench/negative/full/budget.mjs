/** Durable, single-process budget. Reserve before dispatch; unknown charges are never refunded. */
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from 'node:fs';
import { privatePath } from './plan.mjs';

export const MAX_USD = 4.3;
export const PRICES = Object.freeze({
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
});
// USD per million tokens is also micro-USD per token. Round UP, never down.
const micro = (usd) => Math.ceil(usd * 1e6);
const validCount = (n) => Number.isSafeInteger(n) && n >= 0;

export function usageCost(model, usage) {
  const p = PRICES[model];
  if (!p || !usage || !validCount(usage.input_tokens) || !validCount(usage.output_tokens))
    throw new Error('Missing or invalid billable usage; reservation remains charged.');
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  if (!validCount(read) || !validCount(write)) throw new Error('Invalid cache usage.');
  if (model === 'claude-haiku-5-5' && usage.input_tokens + read + write > 100_000)
    throw new Error('Rater request exceeded registered pricing tier.');
  return Math.ceil(
    usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      read * p.cacheRead +
      write * p.cacheWrite,
  );
}

export function requestBound(model, countedInput, maxOutput) {
  if (!PRICES[model] || !validCount(countedInput) || !validCount(maxOutput) || maxOutput === 0)
    throw new Error('A priced model and bounded request are required.');
  // Counting is an estimate. Cover framing variation and the dearest 5-minute cache writes.
  const inputBound = countedInput + Math.max(256, Math.ceil(countedInput * 0.1));
  if (model === 'claude-haiku-5-5' && inputBound > 100_000)
    throw new Error('Rater request exceeds registered pricing tier.');
  return Math.ceil(inputBound * PRICES[model].cacheWrite + maxOutput * PRICES[model].output);
}

export class BudgetLedger {
  constructor(path, capUsd = MAX_USD) {
    if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > MAX_USD)
      throw new Error('Budget must be positive and no more than $4.30.');
    this.path = privatePath(path);
    this.cap = micro(capUsd);
    this.entries = new Map();
    this.halted = false;
    const events = existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
      : [];
    for (const e of events) this.apply(e);
    if (!events.length) this.write({ type: 'budget', cap: this.cap });
    // A process crash may have sent a request. Retain all unsettled reservations on resume.
  }
  apply(e) {
    if (e.type === 'budget') {
      if (e.cap !== this.cap) throw new Error('Cannot change the persisted budget.');
    } else if (e.type === 'reserve') {
      if (this.entries.has(e.id) || !validCount(e.bound) || !e.bound)
        throw new Error('Invalid reservation.');
      this.entries.set(e.id, { ...e, status: 'reserved', charged: e.bound });
    } else if (e.type === 'settle') {
      const old = this.entries.get(e.id);
      if (!old || old.status !== 'reserved' || !validCount(e.actual))
        throw new Error('Invalid settlement.');
      this.entries.set(e.id, { ...old, status: 'settled', charged: e.actual, usage: e.usage });
      if (e.actual > old.bound) this.halted = true;
    } else if (e.type === 'uncertain') {
      const old = this.entries.get(e.id);
      if (!old || old.status !== 'reserved') throw new Error('Invalid uncertain settlement.');
      this.entries.set(e.id, { ...old, status: 'uncertain' });
    } else throw new Error('Unknown budget event.');
    if (this.total() > this.cap) this.halted = true;
  }
  write(event) {
    privatePath(this.path);
    const fd = openSync(this.path, 'a', 0o600);
    try {
      appendFileSync(fd, `${JSON.stringify(event)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.apply(event);
  }
  total() {
    return [...this.entries.values()].reduce((n, e) => n + e.charged, 0);
  }
  reserve(id, model, bound, purpose, holdbackMicro = 0) {
    if (this.entries.has(id)) throw new Error('A request ID cannot be reused.');
    if (
      this.halted ||
      !validCount(bound) ||
      !validCount(holdbackMicro) ||
      bound <= 0 ||
      this.total() + bound + holdbackMicro > this.cap
    )
      throw new Error('Budget stop: this bounded request cannot fit within $4.30.');
    this.write({ type: 'reserve', id, model, purpose, bound, at: new Date().toISOString() });
  }
  settle(id, usage) {
    const e = this.entries.get(id);
    if (!e || e.status !== 'reserved') throw new Error('No active reservation.');
    const actual = usageCost(e.model, usage);
    this.write({ type: 'settle', id, actual, usage });
    if (this.halted)
      throw new Error('Usage exceeded reservation: stop and reconcile before more calls.');
  }
  uncertain(id) {
    this.write({ type: 'uncertain', id });
  }
  summary() {
    return {
      capUsd: this.cap / 1e6,
      chargedUsd: this.total() / 1e6,
      settledUsd:
        [...this.entries.values()]
          .filter((e) => e.status === 'settled')
          .reduce((n, e) => n + e.charged, 0) / 1e6,
      calls: this.entries.size,
      uncertain: [...this.entries.values()].filter((e) => e.status !== 'settled').length,
      halted: this.halted,
    };
  }
}
