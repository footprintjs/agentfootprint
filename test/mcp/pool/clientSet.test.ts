/**
 * The client sets (§ 5.3): what the pool remembers of a key is written once,
 * when a client leaves its key — never again by a client that already left.
 */

import { describe, expect, it } from 'vitest';

import { ClientSet } from '../../../src/mcp/pool/clientSet.js';
import { poolKeyOf } from '../../../src/mcp/pool/identityKey.js';
import type { ClientPlan } from '../../../src/mcp/pool/plan.js';
import { PooledClient } from '../../../src/mcp/pool/pooledClient.js';
import { NO_NETWORK } from './stubClient.js';

const PLAN: ClientPlan = { transport: NO_NETWORK, configHash: 'h', context: 'pc:h', shared: false };

function keyOf(conversationId: string) {
  const key = poolKeyOf(
    { principal: 'alice', conversationId },
    { requirePrincipal: true, requireTenant: false },
  );
  if (typeof key === 'string') throw new Error(key);
  return key;
}

describe('why the previous client left', () => {
  it('a client ending after its key opened the next one records nothing: the next open after that says what really happened', () => {
    const set = new ClientSet();
    const key = keyOf('a');
    // As the pool does: the incarnation is counted when each client opens.
    expect(set.nextIncarnation(key.key)).toEqual({ generation: 1 });
    const first = new PooledClient(key, PLAN, 1, 0);
    set.admit(first);
    set.retire(first, 'terminated');
    // The key's next client opens while the first still waits to end.
    expect(set.nextIncarnation(key.key)).toEqual({ generation: 2, previous: 'terminated' });
    const second = new PooledClient(key, PLAN, 2, 0);
    set.admit(second);
    // The first one ends now: it already left its key, so nothing is recorded again.
    set.moveToEnding(first, 'terminated');
    set.ended(first);
    // The second's open fails: it leaves with no reason of its own.
    set.drop(second);
    expect(set.nextIncarnation(key.key)).toEqual({ generation: 3 });
  });

  it('the current client leaving records why', () => {
    const set = new ClientSet();
    const key = keyOf('b');
    expect(set.nextIncarnation(key.key)).toEqual({ generation: 1 });
    const client = new PooledClient(key, PLAN, 1, 0);
    set.admit(client);
    set.moveToEnding(client, 'idle');
    expect(set.nextIncarnation(key.key)).toEqual({ generation: 2, previous: 'idle' });
  });
});
