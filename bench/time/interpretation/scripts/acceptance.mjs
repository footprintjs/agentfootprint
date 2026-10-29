// Acceptance cases for the scope digest: what the person confirms is bound to the call that runs
// (design § 8.4, R15). They run the prototype in binding.mjs, not the library.  Run: npm run acceptance
import test from 'node:test';
import assert from 'node:assert/strict';
import { atDispatch, batchDigest, canonical, scopeDigest, scopeOf } from './binding.mjs';

const executed = { from: '2026-10-27T07:30:00Z', to: '2026-10-27T09:30:00Z', zone: 'UTC' };
const period = { forms: [{ kind: 'lookback', argument: 'window', signed: false }], direction: 'past', shapes: ['rolling-lookback'] };
/** The confirmed call: a customer, a node and the window. */
const call = { tool: 'readings', args: { customer: 'acme', node: 8, window: '2h' }, executed, mention: 0 };
const confirm = (declaration, ...calls) => new Set(calls.map((c) => scopeDigest(c, declaration)));
const withArgs = (c, args) => ({ ...c, args: { ...c.args, ...args } });

test('a tool with no Tool.search binds every argument: a changed customer or node asks again before dispatch', () => {
  const declaration = { period }; // no search declaration at all
  const ok = confirm(declaration, call);
  assert.equal(atDispatch(ok, withArgs(call, { customer: 'globex' }), declaration).outcome, 'ask-again');
  assert.equal(atDispatch(ok, withArgs(call, { node: 9 }), declaration).outcome, 'ask-again');
  assert.equal(atDispatch(ok, call, declaration).outcome, 'run', 'the identical call reuses the confirmation');
});

test('the same argument marked inert: a changed customer does not ask again; a bound argument still does', () => {
  const declaration = {
    period,
    search: { arguments: [{ name: 'customer', role: 'inert' }, { name: 'node', role: 'population' }, { name: 'window', role: 'period' }] },
  };
  const ok = confirm(declaration, call);
  assert.equal(atDispatch(ok, withArgs(call, { customer: 'globex' }), declaration).outcome, 'run');
  assert.equal(atDispatch(ok, withArgs(call, { node: 9 }), declaration).outcome, 'ask-again');
});

test('a partial Tool.search that leaves an argument out still binds it (defence in depth: the library refuses one today)', () => {
  const declaration = { period, search: { arguments: [{ name: 'window', role: 'period' }] } }; // customer and node undeclared
  const ok = confirm(declaration, call);
  assert.equal(atDispatch(ok, withArgs(call, { customer: 'globex' }), declaration).outcome, 'ask-again');
  assert.equal(atDispatch(ok, withArgs(call, { node: 9 }), declaration).outcome, 'ask-again');
  assert.equal(atDispatch(ok, call, declaration).outcome, 'run');
});

test('the sampling step is in the digest whatever role its argument carries', () => {
  const declaration = { period: { ...period, sampling: { argument: 'every', units: 'mh' } }, search: { arguments: [{ name: 'every', role: 'inert' }] } };
  const sampled = { ...call, args: { ...call.args, every: '5m' }, sampling: '5m' };
  const ok = confirm(declaration, sampled);
  assert.equal(atDispatch(ok, { ...sampled, args: { ...sampled.args, every: '10m' }, sampling: '10m' }, declaration).outcome, 'ask-again');
  assert.equal(atDispatch(ok, sampled, declaration).outcome, 'run');
});

test('a different tool, a new declaration version, or moved bounds asks again', () => {
  const declaration = { period };
  const ok = confirm(declaration, call);
  assert.equal(atDispatch(ok, { ...call, tool: 'other_readings' }, declaration).outcome, 'ask-again');
  assert.equal(atDispatch(ok, call, { period: { ...period, retention: '30d' } }).outcome, 'ask-again');
  const moved = { ...executed, from: '2026-10-27T07:45:00Z', to: '2026-10-27T09:45:00Z' };
  assert.equal(atDispatch(ok, { ...call, executed: moved }, declaration).outcome, 'ask-again');
});

test('a call added to a confirmed batch is a new batch digest (membership only: the batch ask is not built)', () => {
  const declarations = { readings: { period }, inventory: { period } };
  const second = { tool: 'inventory', args: { customer: 'acme' }, executed, mention: 0 };
  assert.notEqual(batchDigest([call], declarations), batchDigest([call, second], declarations));
  assert.equal(batchDigest([call, second], declarations), batchDigest([call, second], declarations));
});

test('with no one to ask, a changed call is refused, never run', () => {
  const declaration = { period };
  const ok = confirm(declaration, call);
  assert.equal(atDispatch(ok, withArgs(call, { customer: 'globex' }), declaration, { canAsk: false }).outcome, 'refused');
});

test('the digest is canonical: key order never changes it, and it is a hash, not the request', () => {
  const declaration = { period };
  const reordered = { tool: 'readings', args: { window: '2h', node: 8, customer: 'acme' }, executed, mention: 0 };
  const digest = scopeDigest(reordered, declaration);
  assert.equal(digest, scopeDigest(call, declaration));
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});

// An argument named "__proto__" is valid JSON. Copied into an ordinary object, `bound['__proto__'] = v`
// runs the inherited setter and the argument drops out of the digest (found in review at b32c49aa).
const parsed = (customer) => ({ tool: 'readings', args: JSON.parse(`{"window":"2h","__proto__":{"customer":"${customer}"}}`), executed, mention: 0 });

test('parsed JSON: an argument named __proto__ is bound like any other; a changed value asks again', () => {
  const declaration = { period };
  const first = parsed('A');
  assert.deepEqual(Object.keys(first.args), ['window', '__proto__'], 'JSON.parse makes it an own argument');
  assert.deepEqual(Object.keys(scopeOf(first, declaration).args), ['window', '__proto__'], 'the digest keeps it');
  assert.notEqual(scopeDigest(first, declaration), scopeDigest(parsed('B'), declaration));
  const ok = confirm(declaration, first);
  assert.equal(atDispatch(ok, parsed('B'), declaration).outcome, 'ask-again');
  assert.equal(atDispatch(ok, parsed('B'), declaration, { canAsk: false }).outcome, 'refused');
  assert.equal(atDispatch(ok, parsed('A'), declaration).outcome, 'run', 'the identical call reuses the confirmation');
  const without = { ...first, args: JSON.parse('{"window":"2h"}') };
  assert.equal(atDispatch(ok, without, declaration).outcome, 'ask-again', 'dropping the argument is a change too');
});

test('parsed JSON: __proto__ nested in an argument value is in the digest; marked inert, it is left out', () => {
  const nested = (customer) => ({ ...call, args: JSON.parse(`{"window":"2h","filter":{"__proto__":{"customer":"${customer}"}}}`) });
  const declaration = { period };
  assert.equal(atDispatch(confirm(declaration, nested('A')), nested('B'), declaration).outcome, 'ask-again');
  const inert = { period, search: { arguments: [{ name: '__proto__', role: 'inert' }] } };
  assert.equal(atDispatch(confirm(inert, parsed('A')), parsed('B'), inert).outcome, 'run');
});

test('only own data is bound: no getter runs, and an inherited property is not an argument', () => {
  const declaration = { period };
  const args = { window: '2h' };
  Object.defineProperty(args, 'customer', { enumerable: true, get() { throw new Error('a getter ran'); } });
  assert.doesNotThrow(() => scopeDigest({ ...call, args }, declaration));
  const inherited = Object.assign(Object.create({ customer: 'acme' }), { window: '2h' });
  assert.deepEqual(Object.keys(scopeOf({ ...call, args: inherited }, declaration).args), ['window']);
});
