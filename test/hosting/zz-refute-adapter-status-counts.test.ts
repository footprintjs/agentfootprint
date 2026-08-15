/**
 * SCRATCH (refutation probe, not a shipped test).
 *
 * Counts what a clean firestore run of today's battery actually reports:
 * passed / declared / not-applicable / failed, plus the battery size.
 */
import { describe, it } from 'vitest';

import {
  runSessionLifecycleConformance,
  sessionLifecycleConformance,
} from '../../src/hosting/index.js';
import type { SessionStoreHarness } from '../../src/hosting/index.js';
import { firestoreSessions } from '../../src/hosting-providers.js';
import { fakeFirestore } from './firestoreDouble.js';

const stores = new WeakMap<object, ReturnType<typeof fakeFirestore>>();

const harness: SessionStoreHarness = {
  name: 'firestoreSessions (double)',
  createStore: () => {
    const fake = fakeFirestore();
    const store = firestoreSessions({ _sdk: fake.sdk });
    stores.set(store, fake);
    return store;
  },
  corrupt: (store, sessionId) => {
    const fake = stores.get(store as object)!;
    const documentId = (store as { documentIdFor(id: string): string }).documentIdFor(sessionId);
    const row = fake.store.get(documentId);
    if (row !== undefined) fake.store.set(documentId, { ...row, envelope: '{not json at all' });
  },
};

describe('refute probe', () => {
  it('prints the firestore conformance tally', async () => {
    // eslint-disable-next-line no-console
    console.log('BATTERY SIZE:', sessionLifecycleConformance.length);
    // eslint-disable-next-line no-console
    console.log('CASE NAMES:', sessionLifecycleConformance.map((c) => c.name).join('\n  '));
    const report = await runSessionLifecycleConformance(harness);
    const tally: Record<string, number> = {};
    for (const o of report.outcomes) {
      tally[o.status] = (tally[o.status] ?? 0) + 1;
      // eslint-disable-next-line no-console
      console.log(`  ${o.status.toUpperCase().padEnd(15)} ${o.case}`);
    }
    // eslint-disable-next-line no-console
    console.log('TALLY:', JSON.stringify(tally));
  });
});
