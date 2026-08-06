/**
 * 3LO consent (8.6.0) — the pause, the refusal, and the law that the
 * authorization URL never reaches a channel the caller did not ask for.
 *
 * The security half is written as a GREP over the serialized artifacts rather
 * than a field-by-field check, on purpose: a new sink that starts copying tool
 * output fails these tests too. That is the property that was missing before
 * 8.6.0 — the token clause of the secrecy suite only ever looked for an issued
 * token, so the consent URL walked past it into thirteen sinks.
 */

import { describe, it, expect } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { recordRun } from '../../src/recorders/observability/recordRun.js';
import { isPaused } from '../../src/core/pause.js';
import {
  CredentialConsentRequiredError,
  type AuthorizationRequiredMode,
} from '../../src/identity.js';
import type { CredentialProvider, CredentialResult } from '../../src/identity.js';
import { bearer } from '../../src/identity.js';

/** The session-correlating `state` — the part that makes the URL a capability. */
const STATE = 'st_9f3c1b7e_CORRELATES_THE_SESSION';
const CONSENT_URL = `https://idp.example.test/oauth2/authorize?client_id=af&scope=invoice.write&state=${STATE}`;
const SESSION_ID = 'sess_a1b2c3';
const TOKEN = 'tok_issued_after_consent_0001';

/** A vault that refuses until `granted` flips — the shape of a real 3LO flow. */
function consentVault(state: { granted: boolean; calls: number }): CredentialProvider {
  return {
    id: 'test-3lo',
    getCredential: (): Promise<CredentialResult> => {
      state.calls += 1;
      return Promise.resolve(
        state.granted
          ? { status: 'issued', credential: bearer(TOKEN) }
          : {
              status: 'authorization-required',
              authorizationUrl: CONSENT_URL,
              sessionId: SESSION_ID,
            },
      );
    },
  };
}

interface Harness {
  agent: ReturnType<ReturnType<typeof Agent.create>['build']>;
  events: { name: string; payload: Record<string, unknown> }[];
  recorder: ReturnType<typeof recordRun>;
  ran: () => boolean;
}

function buildAgent(
  vault: CredentialProvider,
  mode?: AuthorizationRequiredMode,
  replies?: readonly unknown[],
): Harness {
  let ran = false;
  const payInvoice = defineTool({
    name: 'pay_invoice',
    description: 'Pay an outstanding invoice.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    needs: { credential: 'billing', mode: 'user', scopes: ['invoice.write'] },
    execute: async (_args, ctx) => {
      ran = true;
      return `PAID with ${ctx.credential ? ctx.credential.kind : '(none)'}`;
    },
  });
  const events: { name: string; payload: Record<string, unknown> }[] = [];
  const agent = Agent.create({
    provider: mock({
      replies: (replies ?? [
        { content: 'paying', toolCalls: [{ id: 'c1', name: 'pay_invoice', args: { id: 'INV-42' } }] },
        { content: 'done', toolCalls: [] },
      ]) as never,
    }),
    model: 'mock',
    maxIterations: 4,
    credentials: vault,
    ...(mode && { onAuthorizationRequired: mode }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
    .tools([payInvoice])
    .recorder({
      id: 'probe',
      onEmit: (e: { name: string; payload: Record<string, unknown> }) =>
        events.push({ name: e.name, payload: e.payload }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .build();
  return { agent, events, recorder: recordRun(agent), ran: () => ran };
}

/** Everything a consumer or a viewer can see, as one string. */
function surfaces(h: Harness): Record<string, string> {
  return {
    snapshot: JSON.stringify(h.agent.getSnapshot() ?? {}),
    narrative: JSON.stringify(h.agent.getLastNarrativeEntries()),
    events: JSON.stringify(h.events),
    recording: JSON.stringify(h.recorder.toRecording()),
  };
}

describe('3LO consent — the URL never reaches a channel the caller did not ask for', () => {
  it("'pause': the state param appears in NO snapshot, narrative, event or recording", async () => {
    const state = { granted: false, calls: 0 };
    const h = buildAgent(consentVault(state));
    const out = await h.agent.run({ message: 'pay invoice INV-42' });
    expect(isPaused(out)).toBe(true);

    for (const [name, blob] of Object.entries(surfaces(h))) {
      expect(blob, `${name} leaked the consent state param`).not.toContain(STATE);
      expect(blob, `${name} leaked the consent host`).not.toContain('idp.example.test');
    }
  });

  it("'tell-model': same law — the model is told, the URL is not", async () => {
    const state = { granted: false, calls: 0 };
    const h = buildAgent(consentVault(state), 'tell-model');
    await expect(h.agent.run({ message: 'pay invoice INV-42' })).rejects.toBeInstanceOf(
      CredentialConsentRequiredError,
    );

    for (const [name, blob] of Object.entries(surfaces(h))) {
      expect(blob, `${name} leaked the consent state param`).not.toContain(STATE);
      expect(blob, `${name} leaked the consent host`).not.toContain('idp.example.test');
    }
    // The model WAS told — it just wasn't handed a capability.
    expect(surfaces(h).snapshot).toMatch(/authorization required: 'billing'/);
  });

  it('the URL DOES reach the caller — a leak test that passes when the feature is deleted is worthless', async () => {
    const state = { granted: false, calls: 0 };
    const paused = buildAgent(consentVault(state));
    const out = await paused.agent.run({ message: 'go' });
    expect(isPaused(out)).toBe(true);
    const block = (out as { pauseData?: { authorization?: Record<string, unknown> } }).pauseData
      ?.authorization;
    expect(block).toEqual({
      service: 'billing',
      authorizationUrl: CONSENT_URL,
      sessionId: SESSION_ID,
    });

    const told = buildAgent(consentVault({ granted: false, calls: 0 }), 'tell-model');
    await told.agent.run({ message: 'go' }).then(
      () => expect.unreachable('should have raised'),
      (e: unknown) => {
        expect(e).toBeInstanceOf(CredentialConsentRequiredError);
        const err = e as CredentialConsentRequiredError;
        expect(err.code).toBe('ERR_CREDENTIAL_CONSENT_REQUIRED');
        expect(err.authorizationUrl).toBe(CONSENT_URL);
        expect(err.sessionId).toBe(SESSION_ID);
        expect(err.service).toBe('billing');
        expect(err.tool).toBe('pay_invoice');
        // The MESSAGE is the string that reaches a log line. Not the URL.
        expect(err.message).not.toContain(STATE);
      },
    );
  });

  it('pause.request withholds the URL BY NAME while keeping the rest of the block', async () => {
    const h = buildAgent(consentVault({ granted: false, calls: 0 }));
    await h.agent.run({ message: 'go' });
    // `pause.request` rides the typed dispatcher, not the scope emit channel,
    // so it is read from the recording — which is also where it would have
    // been persisted, and therefore the surface that had to be bounded.
    const req = h.recorder
      .toRecording()
      .events.find((e) => e.type === 'agentfootprint.pause.request');
    expect(req).toBeTruthy();
    const q = (req!.payload as { questionPayload: unknown }).questionPayload as {
      authorization: { service: string; sessionId: string; authorizationUrl: string };
    };
    // The observer still learns WHICH service and WHICH session — only the
    // capability is withheld.
    expect(q.authorization.service).toBe('billing');
    expect(q.authorization.sessionId).toBe(SESSION_ID);
    expect(q.authorization.authorizationUrl).not.toContain(STATE);
    expect(q.authorization.authorizationUrl).toMatch(/withheld/i);
  });

  it('the authorization_required event still carries {service, sessionId} and nothing more', async () => {
    const h = buildAgent(consentVault({ granted: false, calls: 0 }));
    await h.agent.run({ message: 'go' });
    const ev = h.events.find(
      (e) => e.name === 'agentfootprint.credential.authorization_required',
    );
    expect(ev?.payload).toEqual({ service: 'billing', sessionId: SESSION_ID });
  });
});

describe('3LO consent — the run behaves honestly', () => {
  it("'pause' stops the run: the tool never ran and the model was never told", async () => {
    const state = { granted: false, calls: 0 };
    const h = buildAgent(consentVault(state));
    const out = await h.agent.run({ message: 'go' });

    expect(isPaused(out)).toBe(true);
    expect(h.ran()).toBe(false);
    expect(state.calls).toBe(1); // resolved once; consent is not a fault to retry
    const history = (h.agent.getSnapshot()?.sharedState as { history?: { role: string }[] })
      ?.history;
    expect((history ?? []).filter((m) => m.role === 'tool')).toHaveLength(0);
  });

  it('resume after consent runs the tool that was waiting, in the SAME run', async () => {
    const state = { granted: false, calls: 0 };
    const h = buildAgent(consentVault(state), undefined, [
      { content: 'paying', toolCalls: [{ id: 'c1', name: 'pay_invoice', args: { id: 'INV-42' } }] },
      { content: 'Invoice INV-42 is paid.', toolCalls: [] },
    ]);
    const out = await h.agent.run({ message: 'go' });
    expect(isPaused(out)).toBe(true);

    state.granted = true; // the person consented, out of band
    const final = await h.agent.resume(
      (out as { checkpoint: never }).checkpoint,
      undefined as never,
    );

    expect(h.ran()).toBe(true);
    expect(String(final)).toBe('Invoice INV-42 is paid.');
    const history = (h.agent.getSnapshot()?.sharedState as { history?: { role: string; content: string }[] })
      ?.history;
    const toolMsgs = (history ?? []).filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0]!.content).toContain('PAID');
    // A completed run does not raise: the consent was given and the work done.
  });

  it('resume while consent is STILL outstanding refuses without a URL and does not re-pause', async () => {
    const state = { granted: false, calls: 0 };
    const h = buildAgent(consentVault(state), undefined, [
      { content: 'paying', toolCalls: [{ id: 'c1', name: 'pay_invoice', args: { id: 'INV-42' } }] },
      { content: 'I could not complete that step.', toolCalls: [] },
    ]);
    const out = await h.agent.run({ message: 'go' });
    expect(isPaused(out)).toBe(true);

    // Resume WITHOUT consent having been granted. A ResumeFn returns void, so
    // it cannot checkpoint again — the honest move is the URL-free refusal,
    // and the turn must still not report a clean completion.
    await expect(
      h.agent.resume((out as { checkpoint: never }).checkpoint, undefined as never),
    ).rejects.toBeInstanceOf(CredentialConsentRequiredError);

    expect(h.ran()).toBe(false);
    for (const [name, blob] of Object.entries(surfaces(h))) {
      expect(blob, `${name} leaked the consent URL on the resume path`).not.toContain(STATE);
    }
  });

  it("'tell-model' flags the blocked call as an error — it is not a successful tool call", async () => {
    const h = buildAgent(consentVault({ granted: false, calls: 0 }), 'tell-model');
    await h.agent.run({ message: 'go' }).catch(() => undefined);
    const end = h.events.find((e) => e.name === 'agentfootprint.stream.tool_end');
    expect(end?.payload.error).toBe(true);
    expect(String(end?.payload.result)).not.toContain(STATE);
  });

  it('an issued credential is byte-for-byte the old path — no pause, no raise, no flag', async () => {
    const state = { granted: true, calls: 0 };
    const h = buildAgent(consentVault(state));
    const answer = await h.agent.run({ message: 'go' });
    expect(isPaused(answer)).toBe(false);
    expect(String(answer)).toBe('done');
    expect(h.ran()).toBe(true);
    const end = h.events.find((e) => e.name === 'agentfootprint.stream.tool_end');
    expect(end?.payload.error).toBeUndefined();
    // And the issued TOKEN obeys the other half of the same law.
    for (const blob of Object.values(surfaces(h))) expect(blob).not.toContain(TOKEN);
  });

  it('a run that was blocked, resumed and succeeded does NOT raise at the end', async () => {
    const state = { granted: false, calls: 0 };
    const h = buildAgent(consentVault(state), undefined, [
      { content: 'paying', toolCalls: [{ id: 'c1', name: 'pay_invoice', args: { id: 'INV-42' } }] },
      { content: 'all set', toolCalls: [] },
    ]);
    const out = await h.agent.run({ message: 'go' });
    state.granted = true;
    const final = await h.agent.resume(
      (out as { checkpoint: never }).checkpoint,
      undefined as never,
    );
    // The consent ledger is about work still owed. This work got done.
    expect(String(final)).toBe('all set');
  });
});
