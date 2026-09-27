/**
 * bench/wire-json.mjs — what the wire rule for Errors costs (`src/lib/wireJson.ts`).
 *
 * The rule renders every Error in an event as `{ name, message, code?, cause? }`.
 * On the SYNC path a serializing sink calls `toWireJson` (JSON.stringify with
 * a replacer that reads the holder's raw value); on the DETACHED path
 * `withWireErrors` walks the event once before the clone. This measures both
 * against the plain call they replace, on a ~500 KB event (2,000 messages) —
 * the size of a long run's `llm_end`.
 *
 * Run it standalone, nothing else on the machine: a bench under a concurrent
 * suite is contaminated.
 *
 *   npm run build && node bench/wire-json.mjs
 */
import { toWireJson, withWireErrors } from '../dist/esm/lib/wireJson.js';

const big = {
  type: 'agentfootprint.stream.llm_end',
  payload: {
    messages: Array.from({ length: 2000 }, (_, i) => ({
      role: 'user',
      content: 'x'.repeat(200),
      meta: { i, tags: ['a', 'b'], nested: { k: i } },
    })),
  },
};

function time(label, fn, n = 50) {
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6 / n;
  console.log(label.padEnd(36), ms.toFixed(3), 'ms/op');
  return ms;
}

console.log(`event: ${(JSON.stringify(big).length / 1024).toFixed(0)} KB`);
const plain = time('JSON.stringify', () => JSON.stringify(big));
const wire = time('toWireJson', () => toWireJson(big));
const clone = time('structuredClone', () => structuredClone(big));
const walked = time('withWireErrors (no Error) + clone', () => structuredClone(withWireErrors(big)));
big.payload.messages[1999].err = Object.assign(new Error('x'), { config: {} });
time('withWireErrors (1 Error) + clone', () => structuredClone(withWireErrors(big)));
console.log(`sync ratio ${(wire / plain).toFixed(2)}x · detached ratio ${(walked / clone).toFixed(2)}x`);
