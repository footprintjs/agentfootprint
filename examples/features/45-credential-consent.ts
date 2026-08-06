/**
 * 45 — 3LO consent: the run pauses, the person clicks, the work gets done.
 *
 * A tool declares `needs: { credential: 'billing', mode: 'user' }`. The vault
 * answers `authorization-required` — somebody has to click a link at the
 * identity provider before this tool can run.
 *
 * **The model is the one party in the room that cannot click it.** Before 8.6.0
 * the consent URL was written into the tool result and handed to the model,
 * which did what models do with a refusal: adapted, wrote a plausible final
 * answer, and returned "done" — 200, complete, invoice unpaid, nobody asked.
 *
 * Now consent is treated as what it is: unfinished work waiting on a person,
 * which is a PAUSE — the same wire `askHuman`, a `checkIn` and a middleware
 * `ask` already ride. The caller gets the URL. The model gets nothing, because
 * there is nothing it can usefully do.
 *
 * **The URL is a bearer capability.** It carries a session-correlating `state`
 * parameter: whoever holds it can complete the consent flow. So it goes to the
 * caller and to nobody else — this example proves it by grepping the whole
 * recording, which is what a viewer, a log pipeline and a session store would
 * each have received.
 *
 * The other mode, `onAuthorizationRequired: 'tell-model'`, is shown at the end:
 * the model may route around the block, but the turn still cannot claim it
 * finished — it raises `CredentialConsentRequiredError`, carrying the URL.
 *
 * Run:  npm run example examples/features/45-credential-consent.ts
 */

import { Agent, defineTool, isPaused, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  CredentialConsentRequiredError,
  type ConsentRequest,
  type CredentialProvider,
  type CredentialResult,
  bearer,
} from '../../src/doors/security.js';
import { recordRun } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/45-credential-consent',
  title: 'Credentials — 3LO consent pauses the run instead of asking the model',
  group: 'features',
  description:
    'A declared credential comes back authorization-required. The run PAUSES and the caller receives the consent URL on the pause outcome; the model is never told, because it cannot click a link. After consent, resume() re-resolves the credential and runs the tool that was waiting — same run, work actually done. The URL is a bearer capability and appears in no snapshot, narrative, event or recording.',
  defaultInput: 'pay invoice INV-42',
  providerSlots: ['default'],
  tags: ['feature', 'identity', 'credentials', 'oauth', 'security', 'pause', 'human-in-the-loop'],
};

/** The session-correlating `state` is the part that makes this a capability. */
const CONSENT_URL =
  'https://idp.example.test/oauth2/authorize?client_id=demo&scope=invoice.write&state=st_7c1a_SESSION';

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // A vault that needs consent the first time and issues once it is given —
  // the shape of a real 3LO flow, with the human step simulated by a boolean.
  let consentGranted = false;
  const vault: CredentialProvider = {
    id: 'demo-3lo',
    getCredential: (): Promise<CredentialResult> =>
      Promise.resolve(
        consentGranted
          ? { status: 'issued', credential: bearer('tok_after_consent') }
          : {
              status: 'authorization-required',
              authorizationUrl: CONSENT_URL,
              sessionId: 'sess_demo',
            },
      ),
  };

  let toolRan = false;
  const payInvoice = defineTool({
    name: 'pay_invoice',
    description: 'Pay an outstanding invoice.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    needs: { credential: 'billing', mode: 'user', scopes: ['invoice.write'] }, // ← declare
    execute: async (_args, ctx) => {
      toolRan = true;
      return `paid with a ${ctx.credential!.kind} credential`;
    },
  });

  const picked = (): LLMProvider =>
    provider ??
    mock({
      replies: [
        { content: 'paying', toolCalls: [{ id: 'c1', name: 'pay_invoice', args: { id: 'INV-42' } }] },
        { content: 'Invoice INV-42 is paid.', toolCalls: [] },
      ],
    });

  // ── Default mode: 'pause' ────────────────────────────────────────
  const agent = Agent.create({ provider: picked(), model: 'mock', maxIterations: 4, credentials: vault })
    .tools([payInvoice])
    .build();

  const recorder = recordRun(agent);
  const first = await agent.run({ message: input });

  // The run did not finish and did not pretend to. `isPaused` narrows to the
  // pause outcome, whose `pauseData.authorization` is what a `standingAgent`
  // hands back as `PendingAsk` on a 202.
  const paused = isPaused(first);
  const block = paused
    ? ((first.pauseData as { authorization?: ConsentRequest } | undefined)?.authorization ?? null)
    : null;

  // What the model was told at the pause: nothing at all.
  const historyAtPause = (agent.getSnapshot()?.sharedState as { history?: { role: string }[] })
    ?.history;
  const toolMessagesAtPause = (historyAtPause ?? []).filter((m) => m.role === 'tool').length;

  // ── The person consents, out of band. Resume the SAME run. ───────
  consentGranted = true;
  const answer = paused ? await agent.resume(first.checkpoint, undefined) : first;

  // ── The security guarantee, measured over everything a consumer sees ──
  const recording = JSON.stringify(recorder.toRecording());
  recorder.stop();
  const everything = [
    recording,
    JSON.stringify(agent.getSnapshot() ?? {}),
    JSON.stringify(agent.getLastNarrativeEntries()),
  ].join('');
  const urlInAnyTrace = everything.includes('st_7c1a_SESSION');

  // ── The other mode: the model adapts, the turn still cannot lie ──
  let tellModelOutcome = '(not run)';
  {
    const denied = true;
    const stubborn = Agent.create({
      provider: mock({
        replies: [
          { content: 'paying', toolCalls: [{ id: 'c1', name: 'pay_invoice', args: { id: 'INV-9' } }] },
          { content: 'I could not pay that invoice.', toolCalls: [] },
        ],
      }),
      model: 'mock',
      maxIterations: 4,
      credentials: {
        id: 'never-consents',
        getCredential: (): Promise<CredentialResult> =>
          Promise.resolve(
            denied
              ? {
                  status: 'authorization-required',
                  authorizationUrl: CONSENT_URL,
                  sessionId: 'sess_demo',
                }
              : { status: 'issued', credential: bearer('unused') },
          ),
      },
      onAuthorizationRequired: 'tell-model',
    })
      .tools([payInvoice])
      .build();
    void denied;
    try {
      await stubborn.run({ message: input });
      tellModelOutcome = 'returned an answer (WRONG — this should not happen)';
    } catch (e) {
      tellModelOutcome =
        e instanceof CredentialConsentRequiredError
          ? `raised ${e.code} for '${e.service}' — URL delivered to the caller, not the log`
          : `raised ${String(e)}`;
    }
  }

  return {
    // 1. The run stopped rather than reporting a completion it had not earned.
    pausedInsteadOfAnswering: paused,
    // 2. The caller — and only the caller — received the capability.
    callerReceived: block,
    // 3. The model was told nothing: no tool result existed at pause time.
    toolMessagesShownToModelAtPause: toolMessagesAtPause,
    // 4. After consent, the SAME run finished the work.
    toolRan,
    answer,
    // 5. And the URL is in none of the artifacts a viewer or log would get.
    urlInAnyTrace, // false
    // 6. The compat mode is honest too.
    tellModelOutcome,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
