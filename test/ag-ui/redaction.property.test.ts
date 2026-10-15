/**
 * PROPERTY — nothing a redaction policy marks ever reaches the AG-UI wire, at
 * any depth; and with no policy, what is not meant for a person stays off it.
 *
 * An AG-UI stream leaves the process for a browser. For each seed, a pipeline is
 * generated with secrets planted everywhere a run carries data:
 *
 *   · the person's message;
 *   · a tool's ARGUMENTS and its RESULT — under marked keys, under marked fields
 *     (nested, dotted), inside free text, inside arrays;
 *   · the answers each agent writes;
 *   · a provider that FAILS with a secret in its error — inside a parallel branch
 *     a tolerant merge survives, and (on half the seeds) as the last step, so the
 *     run itself fails;
 *
 * across a footprintjs composition: a sequence step, a parallel fan-out of two
 * sub-agents, and a final step. Every agent carries the generated policy (several
 * marked keys, and fields). The whole stream is framed by `agUiSse` — the bytes a
 * browser receives — and no secret may appear in it. The same holds when an app
 * allow-lists EVERY event as CUSTOM, because the guarantee is the record's
 * (served events only), not the allow-list's.
 *
 * A pause and the run that continues it hold the same law, across both requests:
 * neither run's frames, nor the suspension kept between them, carry a marked value.
 *
 * The last half pins the allow-list itself, with no policy at all: the system
 * prompt, a provider's raw retry error and the model's reasoning are in the
 * record, and none of them goes out by default.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, Parallel, Sequence } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { pauseHere } from '../../src/core/pause.js';
import { withRetry } from '../../src/resilience/withRetry.js';
import { mockThinkingHandler } from '../../src/thinking/MockThinkingHandler.js';
import { ALL_EVENT_TYPES } from '../../src/events/registry.js';
import { agUiSse } from '../../src/ag-ui/framing.js';
import type { AgUiCustomProjection } from '../../src/ag-ui/serializer.js';
import { replayThroughClient, runAsAgUi } from './helpers.js';

/** mulberry32 — the same draws every run. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

const KEY_WORDS = ['ssn', 'email', 'phone', 'iban', 'dob', 'pin', 'passport', 'salary'];

/** One generated world: the secrets, the policy that marks them, and the pipeline. */
function world(seed: number) {
  const draw = rng(seed);
  const secrets: string[] = [];
  /** A fresh secret: lower-case letters and digits no library word contains. */
  const secret = (): string => {
    let s = 'zq';
    for (let i = 0; i < 14; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(draw() * 31)];
    secrets.push(s);
    return s;
  };
  const shuffled = [...KEY_WORDS].sort(() => draw() - 0.5);
  const [k1, k2, k3] = shuffled as [string, string, string];
  const policy = {
    keys: [k1, k2],
    fields: { profile: [k3, 'address.zip'] },
    patterns: [/token$/],
  };

  const lookup = defineTool({
    name: 'lookup',
    description: 'Look a customer up.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({
      [k1]: secret(),
      profile: {
        [k3]: secret(),
        address: { zip: secret(), city: 'Lyon' },
        note: `seen ${secret()}`,
      },
      items: [{ [k2]: secret() }, `free ${secret()}`],
      accessToken: secret(),
    }),
  });

  const talk = (replies: unknown[]) =>
    Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: replies as never }),
      model: 'm',
      redact: policy,
    })
      .system('Help.')
      .tool(lookup)
      .build();
  const failing = (what: string) =>
    Agent.create({
      provider: {
        name: 'down',
        complete: async () => {
          throw new Error(`upstream rejected ${what} for ${secret()}`);
        },
      } as never,
      model: 'm',
      redact: policy,
    })
      .system('Help.')
      .build();
  const callWithSecrets = () => ({
    content: `checking ${secret()}`,
    toolCalls: [{ id: 'c1', name: 'lookup', args: { [k1]: secret(), query: `find ${secret()}` } }],
  });

  const intake = talk([callWithSecrets(), `intake says ${secret()}`]);
  const left = talk([callWithSecrets(), `left says ${secret()}`]);
  const right = failing('branch');
  const fan = Parallel.create()
    .branch('left', left)
    .branch('right', right)
    .mergeOutcomesWithFn((outcomes) => JSON.stringify(outcomes))
    .build();
  const lastFails = draw() < 0.5;
  const last = lastFails ? failing('final') : talk([`final says ${secret()}`]);
  const pipeline = Sequence.create()
    .step('intake', intake)
    .step('fan', fan)
    .step('last', last)
    .build();
  return { pipeline, secrets, message: `customer ${secret()} asks`, lastFails };
}

/** Every event type as CUSTOM, its served payload whole — the most an app could allow. */
const EVERYTHING: Readonly<Record<string, AgUiCustomProjection>> = Object.fromEntries(
  ALL_EVENT_TYPES.map((type) => [type, (payload: Readonly<Record<string, unknown>>) => payload]),
);

describe('property — a policy holds on the AG-UI wire at every depth', () => {
  for (let seed = 1; seed <= 8; seed++) {
    it(`seed ${seed}: no marked value in any frame — subflows, parallel branches, failures`, async () => {
      const framing = agUiSse();
      for (const options of [{}, { reasoning: true, custom: EVERYTHING }]) {
        const w = world(seed);
        const run = await runAsAgUi(w.pipeline, { message: w.message }, { serializer: options });
        const wire = run.events.map((e) => framing.frame(e)).join('');
        for (const s of w.secrets) expect(wire, `secret ${s} reached the wire`).not.toContain(s);
        // The run really happened at every depth, and ended as the seed says.
        expect(run.events.filter((e) => e.type === 'SUBAGENT_STARTED')).toHaveLength(4);
        expect(run.events.at(-1)!.type).toBe(w.lastFails ? 'RUN_ERROR' : 'RUN_FINISHED');
        expect(run.events.some((e) => e.type === 'SUBAGENT_ERROR')).toBe(true); // the failed branch
        // …and the client still accepts what is left.
        await replayThroughClient(run.events);
      }
    });
  }
});

describe('a pause and the run that continues it, under a policy', () => {
  for (let seed = 1; seed <= 4; seed++) {
    it(`seed ${seed}: neither run's frames nor the kept suspension hold a marked value`, async () => {
      const draw = rng(seed * 7919);
      const secrets: string[] = [];
      const secret = (): string => {
        let s = 'zq';
        for (let i = 0; i < 14; i++)
          s += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(draw() * 31)];
        secrets.push(s);
        return s;
      };
      const policy = { keys: ['iban'], fields: { profile: ['email'] } };
      // A tool that pauses with the question in free text and a marked key beside it.
      const asking = defineTool({
        name: 'confirm',
        description: 'Confirm with a person.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => pauseHere({ question: `Pay ${secret()}?`, iban: secret() }),
      });
      const paying = Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [
            {
              content: `about to pay ${secret()}`,
              toolCalls: [{ id: 'c1', name: 'confirm', args: { iban: secret(), note: secret() } }],
            },
            `paid ${secret()}`,
          ],
        }),
        model: 'm',
        redact: policy,
      })
        .system('Pay.')
        .tool(asking)
        .build();
      const pipeline = Sequence.create()
        .step(
          'p',
          Parallel.create()
            .branch('x', paying)
            .branch(
              'y',
              Agent.create({
                provider: mock({ chunkDelayMs: 0, replies: [`other ${secret()}`] }),
                model: 'm',
                redact: policy,
              })
                .system('s')
                .build(),
            )
            .mergeWithFn((r) => JSON.stringify(r))
            .build(),
        )
        .build();
      const framing = agUiSse();
      const first = await runAsAgUi(pipeline, { message: `pay ${secret()}` }, { runId: 'ag-1' });
      const suspension = first.translation.suspension()!;
      const second = await runAsAgUi(pipeline, undefined, {
        runId: 'ag-2',
        serializer: { resume: suspension },
        resume: {
          checkpoint: (first.out as { checkpoint: unknown }).checkpoint,
          answer: { approved: true, iban: secret() },
        },
      });
      const wire = [...first.events, ...second.events].map((e) => framing.frame(e)).join('');
      const kept = JSON.stringify(suspension);
      for (const s of secrets) {
        expect(wire, `secret ${s} reached the wire`).not.toContain(s);
        expect(kept, `secret ${s} reached the kept suspension`).not.toContain(s);
      }
      // The continuation really continued the paused sub-agent.
      expect(second.events.some((e) => e.type === 'SUBAGENT_STARTED')).toBe(true);
      expect(second.events.some((e) => e.type === 'TOOL_CALL_RESULT')).toBe(true);
    });
  }
});

describe('the allow-list — what is not meant for a person stays off the wire, with no policy', () => {
  it('the system prompt, a raw retry error and the model’s reasoning do not go out by default', async () => {
    let calls = 0;
    const flaky = {
      name: 'flaky',
      thinkingHandler: mockThinkingHandler,
      complete: async () => {
        calls += 1;
        if (calls === 1) throw new Error('rate limited for key zqRETRYSECRET');
        return {
          content: 'Fine.',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
          rawThinking: {
            kind: 'anthropic',
            blocks: [{ type: 'thinking', thinking: 'zqTHINKSECRET' }],
          },
        };
      },
    };
    const agent = Agent.create({
      provider: withRetry(flaky as never, { maxAttempts: 2, initialDelayMs: 0 }),
      model: 'm',
    })
      .system('Internal rules: zqPROMPTSECRET')
      .build();
    const run = await runAsAgUi(agent, { message: 'hi' });

    // The record holds every one of them…
    const record = JSON.stringify(run.served);
    for (const s of ['zqRETRYSECRET', 'zqTHINKSECRET', 'zqPROMPTSECRET'])
      expect(record).toContain(s);
    // …and none of them reaches the wire.
    const framing = agUiSse();
    const wire = run.events.map((e) => framing.frame(e)).join('');
    for (const s of ['zqRETRYSECRET', 'zqTHINKSECRET', 'zqPROMPTSECRET'])
      expect(wire).not.toContain(s);
    // What does go out: the answer, and the retry as a count.
    expect(wire).toContain('Fine.');
    expect(wire).toContain('agentfootprint.error.retried');
  });
});
