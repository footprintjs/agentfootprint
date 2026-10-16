/**
 * Property — a request credential, and the host-filled argument made from it,
 * never appears in the record, the narrative, the events, the model's view or
 * an error's output.
 *
 * Seeded, so a failure names a reproducible secret. Each case runs a real
 * agent whose MCP tool takes a host-filled `token`, against a server that
 * ECHOES its arguments (into its result, or into an error it throws), and
 * whose model also tries to set the field itself. The record of every channel
 * a reader can reach is then searched for the secret, and for every other
 * value the request carried.
 */

import { describe, expect, it } from 'vitest';

import { Agent, fromCredential, hostFilled } from '../../src/index.js';
import { mock, mockMcpClient } from '../../src/doors/providers.js';
import { decodedWith, requestContext, requestCredentials } from '../../src/doors/security.js';
import { seeded } from '../helpers/seededText.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~+/=:';

/** A secret of 16–48 characters from a token alphabet (base64url, JWT punctuation). */
function secretFrom(next: () => number): string {
  const length = 16 + Math.floor(next() * 33);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return out;
}

type Echo = 'result' | 'error' | 'quiet';

interface Case {
  readonly seed: number;
  readonly sealed: string; // what the request carries (an "encrypted" token)
  readonly other: string; // a second request secret no service reads
  readonly echo: Echo;
  readonly modelTries: boolean; // whether the model also sends the field
  readonly providerFails: boolean; // whether the run ends in a thrown error
}

function cases(count: number): Case[] {
  const out: Case[] = [];
  for (let seed = 1; seed <= count; seed++) {
    const next = seeded(seed * 7919);
    const echoes: Echo[] = ['result', 'error', 'quiet'];
    out.push({
      seed,
      sealed: secretFrom(next),
      other: secretFrom(next),
      echo: echoes[Math.floor(next() * echoes.length)]!,
      modelTries: next() < 0.5,
      providerFails: next() < 0.3,
    });
  }
  return out;
}

/** The decrypted form is the sealed value reversed — so both must stay out. */
const decrypt = (raw: string) => raw.split('').reverse().join('');

async function runCase(c: Case): Promise<{ readonly channels: Record<string, string> }> {
  const server = mockMcpClient({
    name: 'crm-mcp',
    tools: [
      {
        name: 'find_account',
        description: 'Find an account',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' }, token: { type: 'string' } },
          required: ['name', 'token'],
        },
        handler: async (args: Record<string, unknown>) => {
          const token = String(args.token);
          if (c.echo === 'error') throw new Error(`401 Unauthorized: token=${token}`);
          return c.echo === 'result' ? `account for ${String(args.name)} via ${token}` : 'found';
        },
      },
    ],
  });
  const tools = hostFilled(await server.tools(), { token: fromCredential({ service: 'crm' }) });
  const requests: string[] = [];
  let calls = 0;
  const agent = Agent.create({
    provider: mock({
      respond: (req) => {
        requests.push(JSON.stringify(req));
        calls++;
        if (calls === 1) {
          return {
            toolCalls: [
              {
                id: 'c1',
                name: 'find_account',
                args: c.modelTries ? { name: 'acme', token: 'model-guess' } : { name: 'acme' },
              },
            ],
          };
        }
        if (calls === 2)
          return { toolCalls: [{ id: 'c2', name: 'find_account', args: { name: 'beta' } }] };
        if (c.providerFails) throw new Error('provider down');
        return { content: 'done' };
      },
    }),
    model: 'mock',
    maxIterations: 4,
    credentials: requestCredentials({
      services: { crm: { secret: 'crmToken', as: decodedWith(decrypt) } },
    }),
  })
    .tools([...tools])
    .build();
  const events: string[] = [];
  agent.on('*', (e) => events.push(JSON.stringify(e)));

  let failure = '';
  let answer = '';
  try {
    answer = JSON.stringify(
      await agent.run(
        { message: 'find acme', identity: { tenant: 't', principal: 'p', conversationId: 'c' } },
        { request: requestContext({ secrets: { crmToken: c.sealed, unused: c.other } }) },
      ),
    );
  } catch (err) {
    const e = err as Error & { checkpoint?: unknown };
    failure = [
      e.message,
      String(e.stack),
      JSON.stringify(e),
      JSON.stringify(e.checkpoint ?? null),
    ].join('\n');
  }
  return {
    channels: {
      answer,
      failure,
      requests: requests.join('\n'),
      events: events.join('\n'),
      snapshot: JSON.stringify(agent.getSnapshot() ?? {}),
      narrative: JSON.stringify(agent.getLastNarrativeEntries()),
      checkpoint: JSON.stringify(agent.checkpoint() ?? null),
    },
  };
}

describe('property — a request credential never reaches a channel a reader can see', () => {
  it.each(cases(24))(
    'seed $seed (echo: $echo, model tries: $modelTries, fails: $providerFails)',
    async (c) => {
      const { channels } = await runCase(c);
      // The control: the host DID fill the argument — the echo that came back
      // was scrubbed, not absent — on every case that echoes into a result.
      if (c.echo === 'result') expect(channels.requests).toContain('[host-filled]');
      for (const [name, text] of Object.entries(channels)) {
        for (const secret of [c.sealed, decrypt(c.sealed), c.other]) {
          expect({ channel: name, leaked: text.includes(secret) }).toEqual({
            channel: name,
            leaked: false,
          });
        }
      }
    },
  );
});
