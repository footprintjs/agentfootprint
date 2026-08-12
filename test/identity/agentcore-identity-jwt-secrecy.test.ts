/**
 * THE JWT-EXCHANGE SECRECY PIN (9.12.0) — the inbound proof and the exchanged
 * token, and nothing that can ever print either.
 *
 * `GetWorkloadAccessTokenForJWT` puts a SECOND secret on this adapter's path.
 * Until now there was one — the credential it vends — and the suites beside
 * this one pin that. The exchange adds the user's own IdP-issued JWT going IN
 * (a live session for a real person, usable by anyone who reads it) and an
 * opaque workload-and-user token coming BACK. Three secrets, one path, and the
 * path is lined with error messages.
 *
 * Why an error message is the dangerous place, specifically: a thrown
 * `getCredential` message is handed to the LLM as the tool's result AND emitted
 * on `agentfootprint.credential.failed`, so it lands in the conversation, in
 * the commit log, in the narrative and in every observability sink at once. One
 * interpolation is a leak to all of them.
 *
 * The suite is the vault adapter's, applied to this path:
 *   P1 every failure path in the exchange, with a secret placed where each one
 *      could plausibly pick it up — including an SDK that echoes the request
 *      it just sent, which is how real AWS clients report transport failures
 *   P2 the refusals still SAY something: the operation, the shape, the fix
 *   P3 through the framework — snapshot, narrative and every emit payload
 *   P4 the positive control: the exchange really happens and the credential
 *      really arrives. A leak test that passes when the feature is deleted is
 *      worthless.
 *
 * Nothing here reaches AWS.
 */

import { describe, expect, it } from 'vitest';

import {
  agentCoreIdentity,
  type BedrockAgentCoreIdentitySdkModule,
} from '../../src/adapters/identity/agentcore.js';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

// ── The secrets. Nothing in this file may echo them. ─────────────────

/** What the user's identity provider signed — a live session for a person. */
const USER_JWT = 'eyJhbGciOiJSUzI1NiJ9.THE-USERS-OWN-LIVE-SESSION.c2lnbmF0dXJl';
/** What AWS answers the exchange with: workload AND user, in one opaque token. */
const EXCHANGED = 'wat_WORKLOAD_AND_USER_9f8e7d';
/** What finally gets vended downstream. */
const VENDED = 'ghp_live_downstream_31337';

const SECRETS = [USER_JWT, EXCHANGED, VENDED];

// ── A scripted SDK ───────────────────────────────────────────────────

type Answer = unknown | ((input: Record<string, unknown>) => unknown);

/** A fake `@aws-sdk/client-bedrock-agentcore`, command-based like the real one.
 *  An answer may be a function, so a command can THROW the way a real client
 *  does — including one that echoes its own request into the error. */
function fakeSdk(answers: Record<string, Answer> = {}): BedrockAgentCoreIdentitySdkModule {
  const command = (name: string) =>
    class {
      readonly __command = name;
      readonly __input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.__input = input;
      }
    } as unknown as new (input: unknown) => unknown;

  return {
    BedrockAgentCoreClient: class {
      constructor(readonly config: { region?: string } = {}) {}
      async send(cmd: unknown): Promise<unknown> {
        const c = cmd as { __command: string; __input: Record<string, unknown> };
        const answer = answers[c.__command];
        return typeof answer === 'function'
          ? (answer as (i: Record<string, unknown>) => unknown)(c.__input)
          : answer ?? {};
      }
      destroy(): void {
        /* the real client has one */
      }
    } as unknown as BedrockAgentCoreIdentitySdkModule['BedrockAgentCoreClient'],
    GetResourceOauth2TokenCommand: command('GetResourceOauth2TokenCommand'),
    GetWorkloadAccessTokenForUserIdCommand: command('GetWorkloadAccessTokenForUserIdCommand'),
    GetWorkloadAccessTokenForJWTCommand: command('GetWorkloadAccessTokenForJWTCommand'),
  };
}

/** Everything a failure can carry into a log: message, name, stack, and the
 *  JSON somebody's error handler will call on it. */
async function failureStrings(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return '';
  } catch (err) {
    const e = err as Error;
    return [e.message, e.name, e.stack ?? '', JSON.stringify(e, Object.getOwnPropertyNames(e))]
      .filter(Boolean)
      .join('\n');
  }
}

/** The provider under test, with a JWT on the request. */
const exchangeWith = (module: BedrockAgentCoreIdentitySdkModule) =>
  agentCoreIdentity({ workloadName: 'my-agent', region: 'us-east-1', _sdk: module }).getCredential({
    service: 'github',
    mode: 'user',
    userToken: USER_JWT,
  });

// ── P1 — every failure path ──────────────────────────────────────────

describe('P1 no failure path prints the JWT, the exchanged token, or the vended one', () => {
  it('none of them, on any of the ways this exchange can fail', async () => {
    const failures = await Promise.all([
      // The exchange answered with nothing at all.
      failureStrings(() => exchangeWith(fakeSdk({}))),

      // It answered with a DIFFERENT shape, whose fields are themselves tokens.
      // The refusal describes the shape; the shape's values are secrets.
      failureStrings(() =>
        exchangeWith(
          fakeSdk({
            GetWorkloadAccessTokenForJWTCommand: { accessToken: EXCHANGED, echoed: USER_JWT },
          }),
        ),
      ),

      // The exchange itself threw, echoing the request it sent — which is what
      // a real AWS client does on a transport failure, and the one shape where
      // the SDK smuggles the caller's own secret back into a message.
      failureStrings(() =>
        exchangeWith(
          fakeSdk({
            GetWorkloadAccessTokenForJWTCommand: (input) => {
              throw new Error(
                `connect ECONNREFUSED — request was ${JSON.stringify(input)} to bedrock-agentcore`,
              );
            },
          }),
        ),
      ),

      // The exchange worked and the VEND threw, echoing the workload token it
      // was given. Second secret, second chance to leak it.
      failureStrings(() =>
        exchangeWith(
          fakeSdk({
            GetWorkloadAccessTokenForJWTCommand: { workloadAccessToken: EXCHANGED },
            GetResourceOauth2TokenCommand: (input) => {
              throw new Error(`ValidationException: bad request ${JSON.stringify(input)}`);
            },
          }),
        ),
      ),

      // The exchange worked and the vend answered with neither a token nor a
      // URL — this adapter's oldest refusal, now downstream of a JWT.
      failureStrings(() =>
        exchangeWith(
          fakeSdk({
            GetWorkloadAccessTokenForJWTCommand: { workloadAccessToken: EXCHANGED },
            GetResourceOauth2TokenCommand: { somethingElse: VENDED },
          }),
        ),
      ),

      // The SDK is too old to have the command. The refusal names the command;
      // it must not name what was going to be sent with it.
      failureStrings(() => {
        const stripped = fakeSdk({});
        return agentCoreIdentity({
          workloadName: 'my-agent',
          _sdk: {
            BedrockAgentCoreClient: stripped.BedrockAgentCoreClient!,
            GetResourceOauth2TokenCommand: stripped.GetResourceOauth2TokenCommand!,
          },
        }).getCredential({ service: 'github', mode: 'user', userToken: USER_JWT });
      }),

      // A JWT with nothing to exchange it against.
      failureStrings(() =>
        agentCoreIdentity({ workloadIdentityToken: 'wit', _sdk: fakeSdk({}) }).getCredential({
          service: 'github',
          mode: 'user',
          userToken: USER_JWT,
        }),
      ),

      // A JWT on a machine request.
      failureStrings(() =>
        agentCoreIdentity({ workloadName: 'my-agent', _sdk: fakeSdk({}) }).getCredential({
          service: 'github',
          mode: 'machine',
          userToken: USER_JWT,
        }),
      ),

      // An injected client with no exchange method.
      failureStrings(() =>
        agentCoreIdentity({
          workloadName: 'my-agent',
          _client: { getResourceOauth2Token: async () => ({ accessToken: VENDED }) },
        }).getCredential({ service: 'github', mode: 'user', userToken: USER_JWT }),
      ),

      // `requireUserToken` with none attached — no JWT in play, and the message
      // must still not invent one or echo the static token beside it.
      failureStrings(() =>
        agentCoreIdentity({
          workloadName: 'my-agent',
          workloadIdentityToken: EXCHANGED,
          requireUserToken: true,
          _sdk: fakeSdk({}),
        }).getCredential({ service: 'github', mode: 'user' }),
      ),

      // The peer dep is genuinely absent in this repo — the load-failure path,
      // with a JWT in hand.
      failureStrings(() =>
        agentCoreIdentity({ workloadName: 'my-agent' }).getCredential({
          service: 'github',
          mode: 'user',
          userToken: USER_JWT,
        }),
      ),
    ]);

    // Every path really failed — a suite of empty strings proves nothing.
    for (const [i, text] of failures.entries()) {
      expect(text, `path ${i} did not fail, so it pins nothing`).not.toBe('');
      for (const secret of SECRETS) {
        expect(text, `a failure leaked a secret:\n${text}`).not.toContain(secret);
      }
      // Nor any recognisable fragment of the JWT: a message that prints half of
      // one is a message that will print all of one after the next refactor.
      for (const part of USER_JWT.split('.')) {
        expect(text, `a failure leaked part of the JWT:\n${text}`).not.toContain(part);
      }
    }
  });
});

// ── P2 — the refusals still teach ────────────────────────────────────

describe('P2 what a refusal DOES say: the operation, the shape, and the fix', () => {
  it('names the operation and the response’s field names, and withholds their values', async () => {
    const text = await failureStrings(() =>
      exchangeWith(
        fakeSdk({
          GetWorkloadAccessTokenForJWTCommand: { accessToken: EXCHANGED, expiresIn: 3600 },
        }),
      ),
    );
    expect(text).toContain('GetWorkloadAccessTokenForJWT');
    expect(text).toContain('workloadAccessToken');
    expect(text).toContain('2 field(s)');
    expect(text).toContain('accessToken, expiresIn');
    expect(text).toMatch(/withheld/i);
  });

  it('an SDK failure keeps its NAME and status, and loses its text', async () => {
    const text = await failureStrings(() =>
      exchangeWith(
        fakeSdk({
          GetWorkloadAccessTokenForJWTCommand: (input) => {
            // A modelled AWS exception, shaped the way the real client shapes
            // one — including the request echo that made this scrub necessary.
            const err = Object.assign(
              new Error(`the workload identity was not found; request: ${JSON.stringify(input)}`),
              { name: 'ResourceNotFoundException', $metadata: { httpStatusCode: 404 } },
            );
            throw err;
          },
        }),
      ),
    );
    // The actionable half survives.
    expect(text).toContain('GetWorkloadAccessTokenForJWTCommand');
    expect(text).toContain('ResourceNotFoundException');
    expect(text).toContain('HTTP 404');
    // The unbounded half does not.
    expect(text).not.toContain('the workload identity was not found');
    expect(text).not.toContain(USER_JWT);
  });

  it('names `workloadName` when there is nothing to exchange against', async () => {
    const text = await failureStrings(() =>
      agentCoreIdentity({ _sdk: fakeSdk({}) }).getCredential({
        service: 'github',
        mode: 'user',
        userToken: USER_JWT,
      }),
    );
    expect(text).toContain('workloadName');
    expect(text).toContain('userToken');
  });
});

// ── P3 — through the framework ───────────────────────────────────────

describe('P3 a tool that passes a JWT leaks it into nothing the run keeps', () => {
  /** A tool that carries the user's JWT in its own closure — the documented
   *  way it travels, because tracked scope and the run input both flow to the
   *  commit log. */
  function jwtTool(): ReturnType<typeof defineTool> {
    return defineTool({
      name: 'read_calendar',
      description: 'read the caller’s calendar',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) => {
        const result = await ctx.credentials.getCredential({
          service: 'google',
          mode: 'user',
          userToken: USER_JWT,
        });
        return result.status === 'issued' ? 'read 3 events' : 'consent required';
      },
    });
  }

  async function runWith(module: BedrockAgentCoreIdentitySdkModule): Promise<{
    answer: string;
    snapshot: string;
    narrative: string;
    events: string;
  }> {
    const events: unknown[] = [];
    const probe = {
      id: 'probe',
      onEmit: (e: { name: string; payload: Record<string, unknown> }) =>
        events.push({ name: e.name, payload: e.payload }),
    };
    const tool = jwtTool();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { content: 'calling', toolCalls: [{ id: 'c1', name: 'read_calendar', args: {} }] },
          { content: 'done', toolCalls: [] },
        ],
      }),
      model: 'mock',
      maxIterations: 3,
      credentials: agentCoreIdentity({ workloadName: 'my-agent', _sdk: module }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
      .tools([tool])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .watch(probe as any)
      .build();
    const answer = await agent.run({ message: 'what is on my calendar?' });
    return {
      answer: String(answer),
      snapshot: JSON.stringify(agent.getSnapshot() ?? {}),
      narrative: JSON.stringify(agent.getLastNarrativeEntries()),
      events: JSON.stringify(events),
    };
  }

  it('not on the happy path — where all three secrets exist at once', async () => {
    const out = await runWith(
      fakeSdk({
        GetWorkloadAccessTokenForJWTCommand: { workloadAccessToken: EXCHANGED },
        GetResourceOauth2TokenCommand: { accessToken: VENDED },
      }),
    );
    expect(out.answer).toBe('done');
    for (const blob of [out.snapshot, out.narrative, out.events, out.answer]) {
      for (const secret of SECRETS) expect(blob).not.toContain(secret);
    }
  });

  it('not on the failing path — where the message itself reaches the model', async () => {
    const out = await runWith(
      fakeSdk({
        GetWorkloadAccessTokenForJWTCommand: (input) => {
          throw new Error(`ThrottlingException on ${JSON.stringify(input)}`);
        },
      }),
    );
    for (const blob of [out.snapshot, out.narrative, out.events, out.answer]) {
      for (const secret of SECRETS) expect(blob).not.toContain(secret);
      for (const part of USER_JWT.split('.')) expect(blob).not.toContain(part);
    }
    // …and the failure really did surface, rather than being swallowed into a
    // clean-looking run.
    expect(out.events).toContain('agentfootprint.credential.failed');
  });
});

// ── P4 — the positive control ────────────────────────────────────────

describe('P4 the feature this suite is guarding actually works', () => {
  it('the JWT is exchanged and the vended credential reaches the tool', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const module = fakeSdk({
      GetWorkloadAccessTokenForJWTCommand: (input) => {
        seen.push(input);
        return { workloadAccessToken: EXCHANGED };
      },
      GetResourceOauth2TokenCommand: (input) => {
        seen.push(input);
        return { accessToken: VENDED };
      },
    });
    const result = await agentCoreIdentity({
      workloadName: 'my-agent',
      _sdk: module,
    }).getCredential({ service: 'github', mode: 'user', userToken: USER_JWT });

    // The user's token really did go to AWS…
    expect(seen[0]).toEqual({ workloadName: 'my-agent', userToken: USER_JWT });
    // …the exchanged one really is what vends…
    expect(seen[1]?.['workloadIdentityToken']).toBe(EXCHANGED);
    // …and the credential really is usable, through the machinery that did not
    // have to change to carry it.
    expect(result.status).toBe('issued');
    expect(result.status === 'issued' && result.credential.toHeaders()).toEqual({
      authorization: `Bearer ${VENDED}`,
    });
  });
});
