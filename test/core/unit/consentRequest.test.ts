/**
 * consentRequest — the law under a consent gate's request, unit by unit:
 * minting (a unique id bound to a detached copy of the call), holding a
 * decision to it (four refusals, by name), the collision check the request id
 * owes as a key derived from caller data, and spending it once.
 */

import { describe, expect, it, vi } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';
import {
  checkDecisionAgainst,
  gatedCallOf,
  heldDecision,
  inMemoryDecisionLedger,
  mintConsentRequest,
  sameBoundArgs,
  spendDecision,
  type DecisionLedger,
  type GatedCall,
} from '../../../src/core/consentRequest.js';
import { DecisionRequiredError, ResumeDecisionError } from '../../../src/core/pause.js';
import { checkInApproved, checkInDeclined } from '../../../src/core/checkin.js';

const call = (over: Partial<GatedCall> = {}): GatedCall => ({
  gate: 'checkIn',
  tool: 'issue_refund',
  toolCallId: 't1',
  party: { channel: 'static' },
  args: { amount: 500, to: 'acct-1' },
  ...over,
});

/** An ask over `call()`, made by the first link of the chain `approval → limit`. */
const askedCall = (over: Partial<GatedCall> = {}): Partial<GatedCall> => ({
  gate: 'ask',
  middleware: 'approval',
  askIndex: 0,
  chain: ['approval', 'limit'],
  ...over,
});

/**
 * Mint, and lay the result out the way the paused run's state holds it. `live`
 * is the agent's whole middleware chain at resume (an ask's rules); it
 * defaults to the chain the ask was made under.
 */
function paused(over: Partial<GatedCall> = {}, live?: readonly string[]) {
  const minted = mintConsentRequest(call(over));
  if (minted === undefined) throw new Error('expected the call to bind');
  const state: Record<string, unknown> = {
    pausedToolName: call(over).tool,
    pausedToolCallId: call(over).toolCallId,
    pausedToolParty: call(over).party,
    pausedRequest: minted.request,
    ...(call(over).gate === 'ask'
      ? {
          pausedAskArgs: minted.args,
          pausedAskMiddleware: call(over).middleware,
          pausedAskIndex: call(over).askIndex,
          pausedAskChain: call(over).chain,
        }
      : { pausedCheckInArgs: minted.args }),
  };
  const gate = call(over).gate;
  const rules = live ?? (Array.isArray(call(over).chain) ? (call(over).chain as string[]) : []);
  return { minted, state, read: (k: string) => state[k], gate, rules };
}

const gateOf = (kind: 'checkIn' | 'ask') => ({ kind, toolName: 'issue_refund' });

const hold = (input: unknown, p: ReturnType<typeof paused>) =>
  heldDecision(
    input,
    gateOf(p.gate),
    p.read('pausedRequest'),
    gatedCallOf(p.read, p.gate),
    p.rules,
  );

function refusedWith(fn: () => unknown, reason: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ResumeDecisionError);
    expect((err as ResumeDecisionError).reason).toBe(reason);
    expect((err as ResumeDecisionError).code).toBe('ERR_RESUME_DECISION');
    return;
  }
  throw new Error(`expected a '${reason}' refusal`);
}

// ── minting ─────────────────────────────────────────────────────────────

describe('mintConsentRequest', () => {
  it('mints a 64-hex id and a 32-hex nonce, unique per pause even for the same call', () => {
    const a = mintConsentRequest(call());
    const b = mintConsentRequest(call());
    expect(a?.request.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.request.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(a?.request.id).not.toBe(b?.request.id);
    expect(a?.request.nonce).not.toBe(b?.request.nonce);
  });

  it('binds a detached copy: changing the caller’s object afterwards changes nothing', () => {
    const args = { amount: 10, lines: [{ sku: 'a' }] };
    const p = paused({ args });
    args.amount = 99_999;
    args.lines[0]!.sku = 'z';
    expect(p.minted.args).toEqual({ amount: 10, lines: [{ sku: 'a' }] });
    const decision = checkInApproved({ request: p.minted.request, by: 'maya' });
    expect(hold(decision, p).requestId).toBe(p.minted.request.id);
  });

  it.each([
    ['a Date', { when: new Date(0) }],
    ['a Map', { items: new Map([['a', 1]]) }],
    ['a non-finite number (JSON.parse reads 1e400 as Infinity)', JSON.parse('{"amount":1e400}')],
    ['a function (cannot be copied)', { fn: () => 1 }],
    ['an array instead of an object', [1, 2]],
    ['no object at all', 'refund'],
  ])('refuses to bind a call whose arguments hold %s', (_label, args) => {
    expect(mintConsentRequest(call({ args }))).toBeUndefined();
  });

  it('refuses to bind a call it cannot copy (a proxy)', () => {
    const proxy = new Proxy({ amount: 1 }, {});
    expect(mintConsentRequest(call({ args: proxy }))).toBeUndefined();
  });
});

// ── the collision check (a key derived from caller data must be injective) ──

describe('the request id — distinct calls never share an id; one call has one', () => {
  /**
   * The id `c` gets under one fixed nonce — the only way two calls' ids can be
   * compared, since a real mint draws a fresh nonce every time.
   */
  function idUnder(nonce: string, c: GatedCall): string {
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        const bytes = array as unknown as Uint8Array;
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(nonce.slice(i * 2, i * 2 + 2), 16);
        }
        return array;
      });
    try {
      const minted = mintConsentRequest(c);
      if (minted === undefined) throw new Error('expected the call to bind');
      expect(minted.request.nonce).toBe(nonce);
      return minted.request.id;
    } finally {
      spy.mockRestore();
    }
  }
  const nonce = 'ab'.repeat(16);

  it.each([
    ['a string and a number', { a: '1' }, { a: 1 }],
    ['a dotted key and a nested key', { 'a.b': 1 }, { a: { b: 1 } }],
    ['an array and an object with index keys', { a: [1, 2] }, { a: { 0: 1, 1: 2 } }],
    ['null and an absent key', { a: null }, {}],
    ['true and "true"', { a: true }, { a: 'true' }],
    ['an escaped quote and two keys', { 'a","b': 1 }, { a: 1, b: 1 }],
    ['the separator character in a value', { a: 'x\u001fy' }, { a: 'x', y: 1 }],
    ['an empty array and an empty object', { a: [] }, { a: {} }],
  ])('distinct arguments: %s', (_label, left, right) => {
    expect(idUnder(nonce, call({ args: left }))).not.toBe(idUnder(nonce, call({ args: right })));
  });

  it.each([
    ['the tool', { tool: 'issue_refund' }, { tool: 'delete_account' }],
    ['the call id', { toolCallId: 't1' }, { toolCallId: 't2' }],
    ['the party', { party: { channel: 'static' } }, { party: { channel: 'skill', id: 's' } }],
    ['the gate', { gate: 'checkIn' as const }, { gate: 'ask' as const }],
    [
      'where the chain resumes',
      { gate: 'ask' as const, middleware: 'm', askIndex: 0 },
      { gate: 'ask' as const, middleware: 'm', askIndex: 1 },
    ],
    [
      'the middleware that asked',
      { gate: 'ask' as const, middleware: 'a', askIndex: 0 },
      { gate: 'ask' as const, middleware: 'b', askIndex: 0 },
    ],
    ['the rules after the ask', askedCall(), askedCall({ chain: ['approval'] })],
    [
      'the order of the rules after the ask',
      askedCall({ chain: ['approval', 'limit', 'audit'] }),
      askedCall({ chain: ['approval', 'audit', 'limit'] }),
    ],
    [
      'a rule name holding a comma',
      askedCall({ chain: ['approval', 'a,b'] }),
      askedCall({ chain: ['approval', 'a', 'b'] }),
    ],
    ['a tool name holding the separator', { tool: 'a\u001fb' }, { tool: 'a' }],
  ])('distinct calls: %s', (_label, left, right) => {
    expect(idUnder(nonce, call(left))).not.toBe(idUnder(nonce, call(right)));
  });

  it('one call has one id — key order and JSON’s own equivalences do not change it', () => {
    const base = idUnder(nonce, call({ args: { a: 1, b: { c: 2, d: 3 } } }));
    expect(idUnder(nonce, call({ args: { b: { d: 3, c: 2 }, a: 1 } }))).toBe(base);
    expect(idUnder(nonce, call({ args: { a: 1, b: { c: 2, d: 3 }, e: undefined } }))).toBe(base);
    expect(idUnder(nonce, call({ args: { a: 0 } }))).toBe(
      idUnder(nonce, call({ args: { a: -0 } })),
    );
  });

  it('the same call under two nonces has two ids', () => {
    expect(idUnder('ab'.repeat(16), call())).not.toBe(idUnder('cd'.repeat(16), call()));
  });
});

// ── holding a decision to the request ───────────────────────────────────

describe('heldDecision', () => {
  it('holds a decision for this request and this call, and returns a detached copy', () => {
    const p = paused();
    const decision = checkInApproved({ request: p.minted.request, by: 'maya', note: 'ok' });
    const held = hold(decision, p);
    expect(held).toEqual(decision);
    expect(held).not.toBe(decision);
  });

  it('holds a decline the same way', () => {
    const p = paused();
    const held = hold(checkInDeclined({ request: p.minted.request, by: 'maya' }), p);
    expect(held.approved).toBe(false);
  });

  it('reads the caller’s decision once: a getter cannot pass the check and answer the use differently', () => {
    const p = paused();
    let reads = 0;
    const shifty = {
      requestId: p.minted.request.id,
      by: 'maya',
      at: 1,
      get approved() {
        reads += 1;
        return reads === 1 ? false : true; // declines for the check, approves for the use
      },
    };
    const held = hold(shifty, p);
    expect(reads).toBe(1);
    expect(held.approved).toBe(false);
  });

  it('refuses an input that cannot even be read with DecisionRequiredError, never a raw throw', () => {
    const p = paused();
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error('trap');
        },
      },
    );
    expect(() => hold(hostile, p)).toThrow(DecisionRequiredError);
  });

  it('refuses a value that is not a decision with DecisionRequiredError', () => {
    const p = paused();
    expect(() => hold('yes', p)).toThrow(DecisionRequiredError);
    expect(() => hold({ approved: 'yes', by: 'm' }, p)).toThrow(DecisionRequiredError);
    expect(() => hold(undefined, p)).toThrow(DecisionRequiredError);
  });

  it("refuses a decision that names no request: 'no-request'", () => {
    const p = paused();
    refusedWith(() => hold({ approved: true, by: 'maya', at: 1 }, p), 'no-request');
    refusedWith(() => hold({ approved: true, by: 'maya', at: 1, requestId: '' }, p), 'no-request');
    refusedWith(() => hold({ approved: true, by: 'maya', at: 1, requestId: 7 }, p), 'no-request');
  });

  it("refuses every decision on a pause that recorded no request: 'request-not-recorded'", () => {
    const p = paused();
    const decision = checkInApproved({ request: p.minted.request, by: 'maya' });
    for (const recorded of [undefined, null, {}, { id: p.minted.request.id }, 'x']) {
      refusedWith(
        () =>
          heldDecision(decision, gateOf('checkIn'), recorded, gatedCallOf(p.read, 'checkIn'), []),
        'request-not-recorded',
      );
    }
    // Malformed fields read as unrecorded too — never half-trusted.
    refusedWith(
      () =>
        heldDecision(
          decision,
          gateOf('checkIn'),
          { id: p.minted.request.id.toUpperCase(), nonce: p.minted.request.nonce },
          gatedCallOf(p.read, 'checkIn'),
          [],
        ),
      'request-not-recorded',
    );
  });

  it("refuses a decision for another request: 'other-request'", () => {
    const p = paused();
    const other = paused();
    refusedWith(
      () => hold(checkInApproved({ request: other.minted.request, by: 'maya' }), p),
      'other-request',
    );
  });

  it('a refusal names no request id — not in its message, not on its fields', async () => {
    // The double click: a client that read the paused request's id out of a
    // refusal and retried with it would approve a request nobody was shown. So
    // a refusal says WHY, never WHICH — for every reason it can give.
    const p = paused();
    const other = paused();
    const forOther = checkInApproved({ request: other.minted.request, by: 'maya' });
    const forThis = checkInApproved({ request: p.minted.request, by: 'maya' });
    const ledger = inMemoryDecisionLedger();
    await spendDecision(ledger, forThis, 'checkIn');
    const changed = paused();
    const forChanged = checkInApproved({ request: changed.minted.request, by: 'maya' });
    changed.state.pausedCheckInArgs = { amount: 1 };
    const refusals: unknown[] = [];
    const collect = (fn: () => unknown): void => {
      try {
        fn();
      } catch (err) {
        refusals.push(err);
      }
    };
    collect(() => hold({ approved: true, by: 'maya', at: 1 }, p)); // no-request
    collect(() =>
      heldDecision(forThis, gateOf('checkIn'), undefined, gatedCallOf(p.read, 'checkIn'), []),
    ); // request-not-recorded
    collect(() => hold(forOther, p)); // other-request
    collect(() => hold(forChanged, changed)); // call-changed
    await spendDecision(ledger, forThis, 'checkIn').catch((err) => refusals.push(err)); // already-answered
    expect(refusals.map((err) => (err as ResumeDecisionError).reason)).toEqual([
      'no-request',
      'request-not-recorded',
      'other-request',
      'call-changed',
      'already-answered',
    ]);
    const ids = [p.minted.request.id, other.minted.request.id, changed.minted.request.id];
    for (const err of refusals) {
      const seen = `${(err as Error).message} ${JSON.stringify(err)} ${JSON.stringify(
        Object.values(err as object),
      )}`;
      for (const id of ids) expect(seen).not.toContain(id);
      expect(err).not.toHaveProperty('requestId');
      expect(err).not.toHaveProperty('pausedRequestId');
    }
  });

  it.each([
    ['the arguments', 'pausedCheckInArgs', { amount: 50_000, to: 'acct-1' }],
    ['the tool', 'pausedToolName', 'delete_account'],
    ['the call id', 'pausedToolCallId', 't9'],
    ['the served party', 'pausedToolParty', { channel: 'skill', id: 'other' }],
    ['the arguments, to a value JSON cannot hold', 'pausedCheckInArgs', { amount: Infinity }],
  ])("refuses when the checkpoint changed %s after the ask: 'call-changed'", (_l, key, value) => {
    const p = paused();
    const decision = checkInApproved({ request: p.minted.request, by: 'maya' });
    p.state[key] = value;
    refusedWith(() => hold(decision, p), 'call-changed');
  });

  it("an ask is bound to where its chain resumes, who asked and the rules after: 'call-changed'", () => {
    for (const [key, value] of [
      ['pausedAskIndex', 3],
      ['pausedAskMiddleware', 'someone-else'],
      ['pausedAskChain', ['approval']],
      ['pausedAskChain', undefined],
    ] as const) {
      const p = paused(askedCall());
      const decision = checkInApproved({ request: p.minted.request, by: 'maya' });
      p.state[key] = value;
      refusedWith(() => hold(decision, p), 'call-changed');
    }
  });

  it("an ask refuses an agent whose rules from the asking one on are not the ones it asked under: 'chain-changed'", () => {
    // Recorded under approval → limit (the ask at index 0). Each of these is a
    // redeploy that would skip, add or move a rule the call has not yet passed.
    for (const live of [
      ['approval'], // the later deny rule removed
      ['approval', 'limit', 'audit'], // a rule added after
      ['limit', 'approval'], // moved: a different link at the ask's index
      ['audit', 'approval', 'limit'], // a link inserted before the ask
      ['approval', 'cap'], // renamed
      [], // no chain at all
    ]) {
      const p = paused(askedCall(), live);
      const decision = checkInApproved({ request: p.minted.request, by: 'maya' });
      refusedWith(() => hold(decision, p), 'chain-changed');
    }
    // The same rules, from the ask on, is the same chain — whatever came before it.
    const later = paused(askedCall({ askIndex: 1, chain: ['approval', 'limit'] }), [
      'scrub',
      'approval',
      'limit',
    ]);
    expect(() =>
      hold(checkInApproved({ request: later.minted.request, by: 'maya' }), later),
    ).not.toThrow();
  });

  it('a check-in is not held to a middleware chain', () => {
    const p = paused({}, ['approval', 'limit']);
    expect(() => hold(checkInApproved({ request: p.minted.request, by: 'maya' }), p)).not.toThrow();
  });

  it('a decision for a check-in does not answer an ask made over the same call', () => {
    const asked = paused(askedCall({ middleware: 'm', chain: ['m'] }));
    // Same nonce and call, read as the other gate: the id derives differently.
    const asCheckIn = {
      ...asked,
      gate: 'checkIn' as const,
      read: (k: string) => (k === 'pausedCheckInArgs' ? asked.state.pausedAskArgs : asked.state[k]),
    };
    const decision = checkInApproved({ request: asked.minted.request, by: 'maya' });
    refusedWith(() => hold(decision, asCheckIn), 'call-changed');
  });
});

// ── the arguments that would run, against the approved copy ─────────────

describe('sameBoundArgs', () => {
  it('the same arguments by JSON: key order and JSON’s own equivalences do not count', () => {
    expect(sameBoundArgs({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(sameBoundArgs({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameBoundArgs({ a: 0 }, { a: -0 })).toBe(true);
  });

  it.each([
    ['a changed value', { amount: 5 }, { amount: 5000 }],
    ['an added key', { amount: 5 }, { amount: 5, to: 'acct-9' }],
    ['a removed key', { amount: 5, to: 'acct-1' }, { amount: 5 }],
    [
      'a value JSON writes the same way (a Date for its string)',
      { at: '1970-01-01T00:00:00.000Z' },
      { at: new Date(0) },
    ],
    ['a value JSON cannot hold', { amount: 5 }, { amount: Infinity }],
    ['no object at all', { amount: 5 }, undefined],
  ])('not the same: %s', (_label, bound, wouldRun) => {
    expect(sameBoundArgs(bound, wouldRun)).toBe(false);
  });
});

// ── checking a checkpoint up front ──────────────────────────────────────

describe('checkDecisionAgainst', () => {
  const checkpointOf = (state: Record<string, unknown>, nested?: string): FlowchartCheckpoint =>
    ({
      sharedState: nested === undefined ? state : {},
      pausedStageId: nested === undefined ? 'tool-calls' : `${nested}/tool-calls`,
      subflowPath: nested === undefined ? [] : [nested],
      subflowStates: nested === undefined ? {} : { [nested]: state },
    } as unknown as FlowchartCheckpoint);

  it('reads the root state for a top-level pause, the innermost subflow’s for a nested one', () => {
    const p = paused();
    const good = checkInApproved({ request: p.minted.request, by: 'maya' });
    const other = checkInApproved({ request: paused().minted.request, by: 'maya' });
    for (const nested of [undefined, 'step-a']) {
      const cp = checkpointOf(p.state, nested);
      expect(() => checkDecisionAgainst(cp, gateOf('checkIn'), good, [])).not.toThrow();
      refusedWith(() => checkDecisionAgainst(cp, gateOf('checkIn'), other, []), 'other-request');
    }
  });

  it('leaves a state it cannot find to the dispatch loop, refusing only a non-decision', () => {
    const cp = {
      sharedState: {},
      subflowPath: ['missing'],
      subflowStates: {},
    } as unknown as FlowchartCheckpoint;
    expect(() =>
      checkDecisionAgainst(cp, gateOf('checkIn'), { approved: true, by: 'm', at: 1 }, []),
    ).not.toThrow();
    expect(() => checkDecisionAgainst(cp, gateOf('checkIn'), 'yes', [])).toThrow(
      DecisionRequiredError,
    );
  });
});

// ── spending once ───────────────────────────────────────────────────────

describe('spendDecision and the ledger', () => {
  const decisionFor = () => checkInApproved({ request: paused().minted.request, by: 'maya' });

  it("spends a request once: the second spend is refused 'already-answered'", async () => {
    const ledger = inMemoryDecisionLedger();
    const decision = decisionFor();
    await expect(spendDecision(ledger, decision, 'checkIn')).resolves.toBeUndefined();
    await expect(spendDecision(ledger, decision, 'checkIn')).rejects.toMatchObject({
      reason: 'already-answered',
      gate: 'checkIn',
    });
  });

  it('two in-memory ledgers are two ledgers; one shared ledger is one', async () => {
    const decision = decisionFor();
    await spendDecision(inMemoryDecisionLedger(), decision, 'checkIn');
    await expect(
      spendDecision(inMemoryDecisionLedger(), decision, 'checkIn'),
    ).resolves.toBeUndefined();
  });

  it('awaits an asynchronous ledger', async () => {
    const seen = new Set<string>();
    const ledger: DecisionLedger = {
      spend: async (id) => {
        await Promise.resolve();
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      },
    };
    const decision = decisionFor();
    await spendDecision(ledger, decision, 'ask');
    await expect(spendDecision(ledger, decision, 'ask')).rejects.toMatchObject({
      reason: 'already-answered',
      gate: 'ask',
    });
  });

  it('fails closed: anything but `true` refuses, and a ledger that throws fails the spend', async () => {
    const decision = decisionFor();
    for (const answer of [undefined, 'yes', 1, null]) {
      const ledger = { spend: () => answer } as unknown as DecisionLedger;
      await expect(spendDecision(ledger, decision, 'checkIn')).rejects.toBeInstanceOf(
        ResumeDecisionError,
      );
    }
    const broken: DecisionLedger = {
      spend: () => {
        throw new Error('store down');
      },
    };
    await expect(spendDecision(broken, decision, 'checkIn')).rejects.toThrow('store down');
  });
});

describe('checkInApproved / checkInDeclined — a decision names its request', () => {
  it('copies the request id and nothing else of the request', () => {
    const p = paused();
    const decision = checkInApproved({ request: p.minted.request, by: 'maya' });
    expect(decision.requestId).toBe(p.minted.request.id);
    expect(decision).not.toHaveProperty('nonce');
  });

  it.each([
    ['no request', { by: 'maya' }],
    ['a request without an id', { request: {}, by: 'maya' }],
    ['a request with an empty id', { request: { id: '' }, by: 'maya' }],
  ])('throws a TypeError for %s', (_label, input) => {
    expect(() => checkInApproved(input as never)).toThrow(TypeError);
    expect(() => checkInDeclined(input as never)).toThrow(TypeError);
  });
});
