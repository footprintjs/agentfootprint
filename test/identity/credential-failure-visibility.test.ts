/**
 * A credential that could not be resolved is an OPERATIONAL event (9.4.0).
 *
 * The AWS identity adapter this release fixes failed on every single call for
 * two minor versions. The failure was on the wire the whole time — and nobody
 * saw it, for three reasons this file pins shut:
 *
 *   1. The `credential` domain had NO WILDCARD. Four event types since 6.11.0
 *      and no way to say "tell me about all of them", so the one audience that
 *      wants them as a group — an operator asking "is anything failing to
 *      authenticate?" — could not subscribe.
 *   2. The event did not name the TOOL. It said a service failed, not what
 *      stopped working, which is the sentence an alert needs.
 *   3. A tool that pulls its own credential (`ctx.credentials.getCredential`)
 *      emitted NOTHING. The throw was caught by the generic tool catch and
 *      became one indistinguishable `error: true` among all the other ways a
 *      tool can fail.
 *
 * And the standing law, tested here too: this event never carries the
 * credential, the token, or a consent URL.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { CredentialProvider, CredentialResult } from '../../src/identity.js';

/** A vault that is down, in the way a real SDK adapter is down. */
class VaultUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultUnreachableError';
  }
}

const BROKEN_REASON =
  'agentCoreIdentity: the SDK client has no getResourceOauth2Token. Confirm the version.';

const broken: CredentialProvider = {
  id: 'broken-vault',
  getCredential(): Promise<CredentialResult> {
    return Promise.reject(new VaultUnreachableError(BROKEN_REASON));
  },
};

interface Captured {
  readonly name: string;
  readonly payload: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runWithTool(tool: any, credentials?: CredentialProvider) {
  const events: Captured[] = [];
  const probe = {
    id: 'probe',
    onEmit: (e: { name: string; payload: Record<string, unknown> }) =>
      events.push({ name: e.name, payload: e.payload }),
  };
  const agent = Agent.create({
    provider: mock({
      replies: [
        { content: 'calling', toolCalls: [{ id: 'c1', name: tool.schema.name, args: {} }] },
        { content: 'done', toolCalls: [] },
      ],
    }),
    model: 'mock',
    maxIterations: 3,
    ...(credentials && { credentials }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
    .tools([tool])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .watch(probe as any)
    .build();

  /** Everything the credential DOMAIN wildcard delivered — point 1 above. */
  const byDomain: Captured[] = [];
  agent.on('agentfootprint.credential.*', (e) =>
    byDomain.push({
      name: (e as { type: string }).type,
      payload: (e as { payload: Record<string, unknown> }).payload,
    }),
  );

  const answer = String(await agent.run({ message: 'go' }));
  const failed = events.find((e) => e.name === 'agentfootprint.credential.failed');
  return { answer, events, byDomain, failed };
}

/** A tool that DECLARES what it needs — the framework resolves it. */
const declaring = defineTool({
  name: 'list_repos',
  description: 'list',
  inputSchema: { type: 'object', properties: {} },
  needs: { credential: 'github', scopes: ['repo'] },
  execute: async () => 'ok',
});

/** A tool that PULLS its own — the path that used to emit nothing at all. */
let pulled = false;
const pulling = defineTool({
  name: 'push_commit',
  description: 'push',
  inputSchema: { type: 'object', properties: {} },
  execute: async (_args, ctx) => {
    pulled = true;
    const result = await ctx.credentials.getCredential({ service: 'github' });
    return `unreachable: ${result.status}`;
  },
});

// ── unit — the declared path names what stopped working ─────────────

describe('credential.failed on the declared-needs path', () => {
  it('names the service, the tool, and the class of failure', async () => {
    const { failed } = await runWithTool(declaring, broken);
    expect(failed).toBeTruthy();
    expect(failed?.payload).toMatchObject({
      service: 'github',
      tool: 'list_repos',
      errorClass: 'VaultUnreachableError',
      reason: BROKEN_REASON,
    });
  });

  it('reports the class of a plain Error too, rather than guessing', async () => {
    const plain: CredentialProvider = {
      id: 'plain',
      getCredential: () => Promise.reject(new Error('nope')),
    };
    const { failed } = await runWithTool(declaring, plain);
    expect(failed?.payload['errorClass']).toBe('Error');
  });

  it('omits the class when what was thrown was not an Error', async () => {
    const odd: CredentialProvider = {
      id: 'odd',
      // eslint-disable-next-line prefer-promise-reject-errors
      getCredential: () => Promise.reject('just a string'),
    };
    const { failed } = await runWithTool(declaring, odd);
    expect(failed).toBeTruthy();
    // 'String' would be a fact about JavaScript, not about the failure.
    expect(failed?.payload).not.toHaveProperty('errorClass');
    expect(failed?.payload['reason']).toBe('just a string');
  });
});

// ── the hole: a tool that asks for its own credential ───────────────

describe('credential.failed on the pull path (ctx.credentials)', () => {
  it('is emitted at all — it was silent before 9.4.0', async () => {
    pulled = false;
    const { failed } = await runWithTool(pulling, broken);
    expect(pulled, 'the tool must really have run and asked').toBe(true);
    expect(
      failed,
      'a tool asking for its own credential must be as visible as a declared one',
    ).toBeTruthy();
  });

  it('names the tool that asked, and the service it asked for', async () => {
    const { failed } = await runWithTool(pulling, broken);
    expect(failed?.payload).toMatchObject({
      service: 'github',
      tool: 'push_commit',
      errorClass: 'VaultUnreachableError',
    });
  });

  it('changes nothing else — the throw still reaches the tool, which still fails', async () => {
    const { events } = await runWithTool(pulling, broken);
    // The decorator reports and rethrows; the tool's own catch (or lack of one)
    // behaves exactly as before, so the failure still lands on the stream's
    // tool_end as it always did.
    const toolEnd = events.find((e) => e.name === 'agentfootprint.stream.tool_end');
    expect(toolEnd?.payload['error']).toBe(true);
  });

  it('a provider that WORKS emits no failure', async () => {
    const working: CredentialProvider = {
      id: 'fine',
      getCredential: async () => ({
        status: 'issued',
        credential: {
          kind: 'bearer',
          toHeaders: () => ({ authorization: 'Bearer t' }),
        } as never,
      }),
    };
    const { events } = await runWithTool(pulling, working);
    expect(events.map((e) => e.name)).not.toContain('agentfootprint.credential.failed');
  });
});

// ── the wildcard the domain never had ───────────────────────────────

describe("agent.on('agentfootprint.credential.*')", () => {
  it('delivers the whole domain, which is how an operator watches for this', async () => {
    const { byDomain } = await runWithTool(declaring, broken);
    const names = byDomain.map((e) => e.name);
    expect(names).toContain('agentfootprint.credential.requested');
    expect(names).toContain('agentfootprint.credential.failed');
  });

  it('delivers the pull path too', async () => {
    const { byDomain } = await runWithTool(pulling, broken);
    expect(byDomain.map((e) => e.name)).toContain('agentfootprint.credential.failed');
  });
});

// ── security — the standing law, restated for the new fields ────────

describe('what this event may never carry', () => {
  it('never the token, never a consent URL — not even in the new fields', async () => {
    const SECRET = 'ghp_never_in_an_event_0001';
    const URL_ = 'https://idp.example.test/authorize?state=st_0002';
    const leaky: CredentialProvider = {
      id: 'leaky',
      getCredential: () =>
        // A provider that echoes request detail into its error is exactly what
        // the port's security contract warns about. The library cannot scrub
        // somebody's message, so this asserts the FIELDS this release added
        // carry nothing of their own.
        Promise.reject(new VaultUnreachableError('401 from the vault')),
    };
    const { failed } = await runWithTool(declaring, leaky);
    const serialized = JSON.stringify(failed?.payload ?? {});
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(URL_);
    expect(Object.keys(failed?.payload ?? {}).sort()).toEqual([
      'errorClass',
      'reason',
      'service',
      'tool',
    ]);
  });
});
