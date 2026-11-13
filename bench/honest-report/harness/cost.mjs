/**
 * bench/honest-report/harness/cost.mjs — what a paid call costs, the one ledger every paid call
 * is written to, and the ceiling (RULE.md § 3, § 8).
 *
 * Why one ledger: the run, the first judge and the second judge spend from ONE ceiling (at most
 * `MAX_USD_CEILING` dollars, named in `plan.json` before anything is paid). Each writes every paid
 * call to `<run folder>/spend.jsonl` as it is paid and reads the total before the next one, so no
 * step can spend what another already did.
 *
 * Prices are `bench/inputs/harness.mjs` · `PRICES` (read from the Claude API reference). One model
 * has two rate cards by prompt length: a request whose prompt is over `LONG_PROMPT[model].over`
 * tokens is priced at `factor` times the row.
 *
 * Example: `costOfReplies([{ usage: { input: 2000, output: 300, cacheRead: 0, cacheWrite: 0 } }], 'claude-haiku-5-5')`
 * → 0.00035.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRICES } from '../../inputs/harness.mjs';
import { MAX_USD_CEILING } from '../rule-tables.mjs';

/** Claude Haiku 5.5's long-prompt card: $0.50 / $2.50, five times the short card (shared/model-migration.md). */
export const LONG_PROMPT = Object.freeze({ 'claude-haiku-5-5': { over: 100_000, factor: 5 } });

/** USD of one request's usage at `model`'s card for that request's prompt length. */
export function costOfUsage(u, model) {
  const p = PRICES[model];
  if (p === undefined) throw new Error(`no price for model '${model}': add its row to bench/inputs/harness.mjs · PRICES first`);
  const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
  const long = LONG_PROMPT[model];
  const f = long !== undefined && prompt > long.over ? long.factor : 1;
  return (f * ((u.input ?? 0) * p.input + (u.output ?? 0) * p.output + (u.cacheRead ?? 0) * p.cacheRead + (u.cacheWrite ?? 0) * p.cacheWrite)) / 1_000_000;
}

/** USD of a run's or a judge call's replies (each `{ usage }`), each priced on its own card. */
export function costOfReplies(replies, model) {
  return replies.reduce((a, r) => a + costOfUsage(r.usage ?? {}, model), 0);
}

/** A `--max-usd` value, checked: a positive number of dollars, at most the ceiling. */
export function maxUsdOf(raw) {
  const n = Number(raw);
  if (!(Number.isFinite(n) && n > 0)) throw new Error(`--max-usd must be a positive number of dollars, saw '${raw}'`);
  if (n > MAX_USD_CEILING) throw new Error(`--max-usd ${raw} is above the ceiling of ${MAX_USD_CEILING} dollars (RULE.md § 8)`);
  return n;
}

export const LEDGER = 'spend.jsonl';

/** The ledger of one run folder: `total()` so far, `pay({ who, usd, runKey })` appends one line. */
export function ledgerOf(dir) {
  const file = join(dir, LEDGER);
  return {
    file,
    total() {
      if (!existsSync(file)) return 0;
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .reduce((a, l) => a + (JSON.parse(l).usd ?? 0), 0);
    },
    pay({ who, usd, runKey }) {
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), who, usd, ...(runKey !== undefined && { runKey }) })}\n`);
    },
  };
}
