/**
 * `agentCoreCodeRunner` — what the ISOLATION KEY may and may not become on the
 * far side of an AWS call.
 *
 * The key is `t=<tenant>/p=<principal>/s=<sessionId>` (see `toolSessionKey`),
 * so it is the one string in this adapter's hands that names a person. Two
 * separate laws about it, both pinned here because both were broken:
 *
 *   • **Nothing that names anybody leaves the process.** The old
 *     `sessionName` folded the key's illegal characters to `-` and sent the
 *     result to `StartCodeInterpreterSession` as its `name` — putting
 *     `af-t-acme-p-alice-s-s1` into a vendor control plane, its console and its
 *     audit log on every session. `hashSessionKey` exists one module over for
 *     exactly this reason, and is what the label is now.
 *   • **Distinct keys stay distinct.** The fold was not injective: `alice:1`
 *     and `alice-1` produced one label, and `.slice(0, 100)` merged any two
 *     keys agreeing on their first 100 characters. `name` is a non-unique
 *     handle AWS never addresses by, so nothing crossed — but an operator
 *     reading the console could not tell two partitions apart, which is the
 *     opposite of what the label is for.
 *
 * And the counterweight, because a relabelling is only safe if nothing is
 * keyed on the label: the ADDRESS is the service-assigned `sessionId`, and it
 * still reaches every `Invoke` and `Stop` byte for byte.
 */

import { describe, expect, it } from 'vitest';

import { agentCoreCodeRunner } from '../../../src/adapters/code/agentcore.js';
import { hashSessionKey, toolSessionKey } from '../../../src/core/toolSessions.js';
import type { AgentCoreCodeClientLike } from '../../../src/adapters/code/agentcore.js';

/** Captures every field the adapter hands the SDK. */
function spyClient(): {
  client: AgentCoreCodeClientLike;
  names: string[];
  invoked: string[];
  stopped: string[];
} {
  const names: string[] = [];
  const invoked: string[] = [];
  const stopped: string[] = [];
  let seq = 0;
  return {
    names,
    invoked,
    stopped,
    client: {
      startSession: (input) => {
        names.push(String(input.name));
        return Promise.resolve({ sessionId: `svc-assigned-${++seq}` });
      },
      invoke: (input) => {
        invoked.push(input.sessionId);
        return Promise.resolve({ stdout: '', stderr: '' });
      },
      stopSession: (input) => {
        stopped.push(input.sessionId);
        return Promise.resolve();
      },
    },
  };
}

async function namesFor(keys: readonly string[]): Promise<string[]> {
  const spy = spyClient();
  const runner = agentCoreCodeRunner({ identifier: 'aws.codeinterpreter.v1', _client: spy.client });
  for (const key of keys) await runner.start({ key });
  return spy.names;
}

// ── 1. SECURITY — no identifier reaches AWS ──────────────────────────

describe('agentCoreCodeRunner — the isolation key never reaches AWS', () => {
  it('sends a digest, not the tenant, the principal or the session id', async () => {
    const key = toolSessionKey(
      {
        toolCallId: 'call-1',
        runId: 'run-1',
        sessionId: 'sess-7f3a',
        identity: { tenant: 'acme-corp', principal: 'alice@acme.example' },
      },
      'session',
    );
    expect(key).toBe('t=acme-corp/p=alice@acme.example/s=sess-7f3a');
    const [name] = await namesFor([key as string]);
    for (const identifier of ['acme', 'alice', 'sess-7f3a', 'example']) {
      expect(name).not.toContain(identifier);
    }
    expect(name).toBe(`af-${hashSessionKey(key as string)}`);
  });

  it('publishes the SAME digest the trace does, so a console row can be joined', async () => {
    // `ToolSessionReport.keyHash` is `hashSessionKey(key)`. An operator holding
    // an AWS session should be able to find its rows; that only works if the
    // two strings are the same string.
    const key = 't=acme/p=ada/s=s1';
    const [name] = await namesFor([key]);
    expect(name).toBe(`af-${hashSessionKey(key)}`);
  });
});

// ── 2. UNIT — distinct keys, distinct labels ─────────────────────────

describe('agentCoreCodeRunner — the session label is injective in practice', () => {
  /** Keys chosen so a plausible normalisation folds at least one pair. */
  const corpus = [
    't=acme/p=alice:1/s=s1',
    't=acme/p=alice-1/s=s1',
    't=acme/p=alice_1/s=s1',
    't=acme/p=alice/s=1',
    't=acme/p=_/s=alice-1',
    't=_/p=_/s=s1',
    'c=call-1',
    `t=acme/p=${'x'.repeat(200)}A/s=s1`,
    `t=acme/p=${'x'.repeat(200)}B/s=s1`,
  ];

  it('maps every distinct key to a distinct label', async () => {
    const names = await namesFor(corpus);
    expect(new Set(names).size).toBe(new Set(corpus).size);
  });

  it('never sends a name AgentCore would reject, whatever the key held', async () => {
    const names = await namesFor([...corpus, 't=a b/p=;DROP TABLE x;--/s=😀']);
    for (const name of names) {
      expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(name.length).toBeLessThanOrEqual(100);
    }
  });
});

// ── 3. SCENARIO — the ADDRESS is untouched ───────────────────────────

describe('agentCoreCodeRunner — the label is not the address', () => {
  it('invokes and stops on the service-assigned sessionId, byte for byte', async () => {
    // The migration promise for this fix: nothing is keyed on the label, so
    // relabelling moves no session. What IS keyed on is the id AWS assigned,
    // and it travels verbatim.
    const spy = spyClient();
    const runner = agentCoreCodeRunner({
      identifier: 'aws.codeinterpreter.v1',
      _client: spy.client,
    });
    const session = await runner.start({ key: 't=acme/p=alice:1/s=s1' });
    expect(session.id).toBe('svc-assigned-1');
    await session.execute({ code: 'print(1)' });
    await session.stop();
    expect(spy.invoked).toEqual(['svc-assigned-1']);
    expect(spy.stopped).toEqual(['svc-assigned-1']);
    // …and the label it was opened under named nobody.
    expect(spy.names).toEqual([`af-${hashSessionKey('t=acme/p=alice:1/s=s1')}`]);
  });
});
