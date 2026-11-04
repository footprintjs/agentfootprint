import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inMemoryDecisionLedger,
  knownDecisionState,
  observeDecisionState,
  hasLocalClose,
  rememberLocalClose,
} from './consentLedger.js';
import {
  closedByAHost,
  closedProvenKey,
  ledgerIdentityOf,
  proveNeverRan,
  registerConsentLedger,
  type DecisionLedger,
} from './consentRequest.js';

afterEach(() => vi.useRealTimers());
it('private membership follows the issued ledger actual Set, not a replaced advisory method', () => {
  const ledger = inMemoryDecisionLedger();
  ledger.isSpent = () => true;
  expect(knownDecisionState(ledger, 'a')).toBe(false);
  expect(ledger.spend('a')).toBe(true);
  expect(knownDecisionState(ledger, 'a')).toBe(true);
  expect(knownDecisionState({ ...ledger }, 'a')).toBeUndefined();
  expect(knownDecisionState(inMemoryDecisionLedger(), 'a')).toBe(false);
});
it.each(['hang', 'throw', 'reject', 'truthy'] as const)(
  'a %s post-failure read is unknown and releases its bound',
  async (shape) => {
    vi.useFakeTimers();
    const ledger: DecisionLedger = {
      spend: () => true,
      isSpent: () => {
        if (shape === 'throw') throw new Error('private backend error');
        if (shape === 'reject') return Promise.reject(new Error('private backend error'));
        if (shape === 'truthy') return 'yes' as never;
        return new Promise<boolean>(() => undefined);
      },
    };
    const pending = observeDecisionState(ledger, 'a');
    await vi.advanceTimersByTimeAsync(101);
    expect(await Promise.race([pending, Promise.resolve('UNSETTLED')])).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it('hang-up stops the optional read and observes a late rejection', async () => {
  let reject!: (reason: unknown) => void;
  const deferred = new Promise<boolean>((_resolve, no) => {
    reject = no;
  });
  const ledger: DecisionLedger = { spend: () => true, isSpent: () => deferred };
  const controller = new AbortController();
  const pending = observeDecisionState(ledger, 'a', controller.signal);
  controller.abort(new Error('caller left'));
  expect(await pending).toBeUndefined();
  reject(new Error('late backend failure'));
  await Promise.resolve();
});
it('a pre-aborted observation never calls the backend', async () => {
  let calls = 0;
  const ledger: DecisionLedger = {
    spend: () => true,
    isSpent: () => {
      calls++;
      return false;
    },
  };
  const controller = new AbortController();
  controller.abort();
  expect(await observeDecisionState(ledger, 'a', controller.signal)).toBeUndefined();
  expect(calls).toBe(0);
});
describe('host-close proof', () => {
  const id = '1'.repeat(64);
  const question = (runner: object, ledger: DecisionLedger) => ({
    requestIds: [id],
    mintedUnder: ledgerIdentityOf(ledger),
    runner,
    storeIsProcessLocal: false,
  });
  it('a cautious opaque positive never becomes proof that a call did not run', async () => {
    const atomic = inMemoryDecisionLedger();
    const ledger = {
      storeId: 'opaque',
      spend: (key: string) => atomic.spend(key),
      isSpent: () => true,
    };
    const runner = {};
    registerConsentLedger(runner, ledger);
    expect(await closedByAHost(question(runner, ledger))).toBe(false);
    expect(await proveNeverRan(question(runner, ledger))).toBe(true);
    // This process retains the actual winning close and its marker acknowledgement.
    expect(await closedByAHost(question(runner, ledger))).toBe(true);
    expect(await proveNeverRan(question(runner, ledger))).toBe(true);
  });
  it('an actual issued-ledger close marker retains its proof', async () => {
    const ledger = Object.assign(inMemoryDecisionLedger(), { storeId: 'actual' }),
      runner = {};
    registerConsentLedger(runner, ledger);
    expect(await proveNeverRan(question(runner, ledger))).toBe(true);
    expect(knownDecisionState(ledger, closedProvenKey(id))).toBe(true);
    expect(await closedByAHost(question(runner, ledger))).toBe(true);
    expect(await proveNeverRan(question(runner, ledger))).toBe(true);
  });
});

it('locally witnessed opaque close proof is scoped by admitted ledger identity and exact request', async () => {
  const atomic = inMemoryDecisionLedger(),
    id = '2'.repeat(64);
  const make = (storeId: string) => ({
    storeId,
    spend: (key: string) => atomic.spend(key),
    isSpent: () => true,
  });
  const first = make('shared-local-proof'),
    owner = {};
  registerConsentLedger(owner, first);
  const q = {
    requestIds: [id],
    mintedUnder: ledgerIdentityOf(first),
    runner: owner,
    storeIsProcessLocal: false,
  };
  expect(await proveNeverRan(q)).toBe(true);
  const replica = make('shared-local-proof'),
    replicaOwner = {};
  registerConsentLedger(replicaOwner, replica);
  expect(await closedByAHost({ ...q, runner: replicaOwner })).toBe(true);
  const foreign = make('foreign-local-proof'),
    foreignOwner = {};
  registerConsentLedger(foreignOwner, foreign);
  expect(
    await closedByAHost({ ...q, runner: foreignOwner, mintedUnder: ledgerIdentityOf(foreign) }),
  ).toBe(false);
  expect(await closedByAHost({ ...q, requestIds: ['3'.repeat(64)] })).toBe(false);
});
it('a failed marker write retains no local close proof', async () => {
  const id = '4'.repeat(64),
    atomic = inMemoryDecisionLedger();
  const ledger = {
    storeId: 'failed-marker-proof',
    spend: (key: string) => {
      if (key.startsWith('closed-proven:')) throw new Error('marker unavailable');
      return atomic.spend(key);
    },
    isSpent: () => true,
  };
  const runner = {};
  registerConsentLedger(runner, ledger);
  const q = {
    requestIds: [id],
    mintedUnder: ledgerIdentityOf(ledger),
    runner,
    storeIsProcessLocal: false,
  };
  expect(await proveNeverRan(q)).toBe(true);
  expect(hasLocalClose(q.mintedUnder, id)).toBe(false);
  expect(await closedByAHost(q)).toBe(false);
});
it('close-proof eviction degrades to unknown without borrowing another request', () => {
  const identity = 'store:bounded-proof',
    first = '5'.repeat(64);
  rememberLocalClose(identity, first);
  expect(hasLocalClose(identity, first)).toBe(true);
  for (let index = 0; index < 1025; index++)
    rememberLocalClose(identity, index.toString(16).padStart(64, '0'));
  expect(hasLocalClose(identity, first)).toBe(false);
  expect(hasLocalClose(identity, 'f'.repeat(64))).toBe(false);
});
it('independently loaded module copies share only the issued capability and local facts', async () => {
  const ledger = inMemoryDecisionLedger();
  ledger.spend('shared-copy');
  const identity = 'store:copy-proof',
    id = '6'.repeat(64);
  rememberLocalClose(identity, id);
  vi.resetModules();
  const other = await import('./consentLedger.js');
  expect(other.knownDecisionState(ledger, 'shared-copy')).toBe(true);
  expect(other.hasLocalClose(identity, id)).toBe(true);
});

it('an observation releases its timer and caller-signal link when the read settles', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const added = vi.spyOn(controller.signal, 'addEventListener'),
    removed = vi.spyOn(controller.signal, 'removeEventListener');
  const ledger: DecisionLedger = { spend: () => true, isSpent: () => false };
  expect(await observeDecisionState(ledger, 'request', controller.signal)).toBe(false);
  expect(added.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(1);
  expect(removed.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['replaced', 'wrapped', 'getter', 'throwing-getter'] as const)(
  'a %s spend owner degrades an issued capability to opaque without invoking a getter',
  (shape) => {
    const ledger = inMemoryDecisionLedger();
    ledger.spend('used');
    const original = ledger.spend;
    let getters = 0;
    if (shape === 'replaced') ledger.spend = () => true;
    if (shape === 'wrapped') ledger.spend = (id) => original(id);
    if (shape === 'getter' || shape === 'throwing-getter')
      Object.defineProperty(ledger, 'spend', {
        get() {
          getters++;
          if (shape === 'throwing-getter') throw new Error('private owner error');
          return original;
        },
      });
    expect(knownDecisionState(ledger, 'used')).toBeUndefined();
    expect(getters).toBe(0);
  },
);
it('unretainable ledger or request names do not enter the bounded proof cache or throw', () => {
  for (const [identity, id] of [
    [undefined, 'f'.repeat(64)],
    ['store:', 'f'.repeat(64)],
    ['store:' + 'x'.repeat(1000), 'f'.repeat(64)],
    ['store:valid', 'not-canonical'],
    ['store:valid', 'F'.repeat(64)],
    ['store:valid', 'f'.repeat(1000)],
  ] as const) {
    expect(() => rememberLocalClose(identity, id)).not.toThrow();
    expect(hasLocalClose(identity, id)).toBe(false);
  }
});
