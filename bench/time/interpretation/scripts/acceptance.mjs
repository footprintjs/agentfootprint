// Acceptance cases for the scope digest: what the person confirms is bound to the call that runs
// (design § 8.4, R15). They run the prototype in binding.mjs, not the library.  Run: npm run acceptance
import test from 'node:test';
import assert from 'node:assert/strict';
import { atDispatch, batchDigest, canonical, scopeDigest } from './binding.mjs';

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

test('a partial Tool.search that leaves an argument out still binds it; nothing is refused', () => {
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

test('a call added to a confirmed batch is a new batch; the same batch is the same digest', () => {
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
