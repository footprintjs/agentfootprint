/**
 * The control half of `Agent.create({ redact })`: what the agent COMPUTES ON and
 * HANDS BACK is never redacted.
 *
 * footprintjs's law covers everything retained or served and never the live
 * heap or the resume checkpoint. For an agent that is: the model's input, the
 * tool's arguments, the answer, the conversation it continues, both kinds of
 * checkpoint, the reply a host streams, a host's session store, and the
 * measurements its own machinery decides on. Each is asserted to carry the REAL
 * value under the very policy that keeps it out of every record — and the
 * record beside it is asserted served, so a test cannot pass by the policy
 * simply never applying.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import {
  Agent,
  askHuman,
  defineTool,
  isPaused,
  RunCheckpointError,
  tokenBudget,
} from '../../src/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import type { WindowRecord } from '../../src/core/agent/window/types.js';
import { recordRun, toSSE } from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { servedUnderPolicy } from '../../src/redaction/marker.js';
import { memorySessions, readEnvelope, standingAgent } from '../../src/hosting/index.js';
import { inProcessHost } from '../hosting/testHost.js';
import {
  ALL_SECRETS,
  MESSAGE,
  SECRET,
  conversationPolicy,
  fixtureAgent,
  leaksIn,
  liveTaps,
} from './fixture.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the live input is never redacted', () => {
  it('the model receives the real message, argument echo and tool result', async () => {
    const taps = liveTaps();
    const agent = fixtureAgent({ redact: conversationPolicy(), taps });
    await agent.run({ message: MESSAGE });
    const sent = taps.requests.join('\n');
    expect(sent).toContain(SECRET.user);
    expect(sent).toContain(SECRET.ssn); // the assistant turn's tool call, on call #2
    expect(sent).toContain(SECRET.email); // the tool result, on call #2
    // …while the record of the same run holds none of it.
    expect(leaksIn(agent.getLastSnapshot())).toEqual([]);
  });

  it('the tool receives the real arguments', async () => {
    const taps = liveTaps();
    const agent = fixtureAgent({ redact: conversationPolicy(), taps });
    await agent.run({ message: MESSAGE });
    expect(taps.toolArgs).toEqual([{ citizenId: 'c-1', ssn: SECRET.ssn }]);
  });

  it('the caller gets the real answer', async () => {
    const agent = fixtureAgent({ redact: conversationPolicy() });
    expect(String(await agent.run({ message: MESSAGE }))).toContain(SECRET.answer);
  });
});

describe('the conversation it continues is never redacted', () => {
  it('checkpoint() carries the real conversation, and followUp continues it', async () => {
    const taps = liveTaps();
    const agent = fixtureAgent({ redact: conversationPolicy(), taps });
    await agent.run({ message: MESSAGE });
    const conversation = JSON.stringify(agent.checkpoint());
    for (const secret of ALL_SECRETS) expect(conversation).toContain(secret);
  });

  it('a second turn sends the model the first turn as it really was', async () => {
    const requests: string[] = [];
    let call = 0;
    const provider: LLMProvider = {
      name: 'two-turns',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(JSON.stringify(req));
        call += 1;
        return {
          content: call === 1 ? `first ${SECRET.answer}` : 'second',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        };
      },
    };
    const agent = Agent.create({ provider, model: 'm', redact: conversationPolicy() }).build();
    await agent.run({ message: MESSAGE });
    await agent.followUp('and then?');
    // The second turn's request carries the first turn — the person's message
    // and the agent's own answer — exactly as they were.
    expect(requests[1]).toContain(SECRET.user);
    expect(requests[1]).toContain(SECRET.answer);
    expect(leaksIn(agent.getLastSnapshot(), [SECRET.user])).toEqual([]);
  });
});

describe('the resume checkpoints are never redacted', () => {
  it('a pause: the checkpoint carries real values; the pause.request event is served', async () => {
    const ask = defineTool<{ ssn: string }, string>({
      name: 'confirm',
      description: 'ask a person to confirm the citizen',
      inputSchema: { type: 'object', properties: { ssn: { type: 'string' } }, required: ['ssn'] },
      execute: ({ ssn }) => askHuman({ question: `Is ${ssn} right?`, ssn }),
    });
    const provider: LLMProvider = {
      name: 'pauses',
      complete: async (): Promise<LLMResponse> => ({
        content: '',
        toolCalls: [{ id: 'p1', name: 'confirm', args: { ssn: SECRET.ssn } }],
        usage: { input: 1, output: 1 },
        stopReason: 'tool_use',
      }),
    };
    const agent = Agent.create({ provider, model: 'm', redact: conversationPolicy() })
      .tool(ask)
      .build();
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (e) => events.push(e));
    const outcome = await agent.run({ message: MESSAGE });
    expect(isPaused(outcome)).toBe(true);
    if (!isPaused(outcome)) return;
    // The checkpoint resumes the run — real values.
    expect(JSON.stringify(outcome.checkpoint)).toContain(SECRET.ssn);
    expect(JSON.stringify(outcome.checkpoint)).toContain(SECRET.user);
    // The question the caller presents is the caller's own value.
    expect(JSON.stringify(outcome.pauseData)).toContain(SECRET.ssn);
    // The RECORD of the pause is served: the field `ssn` at any depth.
    const request = events.find((e) => e.type === 'agentfootprint.pause.request');
    expect(request).toBeDefined();
    expect(JSON.stringify(request?.payload)).not.toContain(`"ssn":"${SECRET.ssn}"`);
    expect(leaksIn(events, [SECRET.user, SECRET.email])).toEqual([]);
  });

  it('a resume on a FRESH instance serves the person’s reply like the same instance would', async () => {
    // A hosted resume often runs on another instance — a later process, another
    // pool lane — that has never run: the reply's event must still be served.
    const build = () => {
      const ask = defineTool<{ ssn: string }, string>({
        name: 'confirm',
        description: 'ask a person to confirm the citizen',
        inputSchema: { type: 'object', properties: { ssn: { type: 'string' } }, required: ['ssn'] },
        execute: ({ ssn }) => askHuman({ question: `Is ${ssn} right?` }),
      });
      let calls = 0;
      const provider: LLMProvider = {
        name: 'pauses-then-answers',
        complete: async (): Promise<LLMResponse> => {
          calls += 1;
          return calls === 1
            ? {
                content: '',
                toolCalls: [{ id: 'p1', name: 'confirm', args: { ssn: SECRET.ssn } }],
                usage: { input: 1, output: 1 },
                stopReason: 'tool_use',
              }
            : {
                content: 'confirmed',
                toolCalls: [],
                usage: { input: 1, output: 1 },
                stopReason: 'stop',
              };
        },
      };
      return Agent.create({ provider, model: 'm', redact: conversationPolicy() }).tool(ask).build();
    };
    const outcome = await build().run({ message: MESSAGE });
    expect(isPaused(outcome)).toBe(true);
    if (!isPaused(outcome)) return;
    const fresh = build();
    const events: AgentfootprintEvent[] = [];
    fresh.on('*', (e) => events.push(e));
    const recorder = recordRun(fresh);
    await fresh.resume(outcome.checkpoint, { answer: `yes, ${SECRET.email}` });
    const resumed = events.find((e) => e.type === 'agentfootprint.pause.resume');
    expect(resumed).toBeDefined();
    expect(JSON.stringify(resumed)).not.toContain(SECRET.email);
    expect(leaksIn(events, [SECRET.email])).toEqual([]);
    expect(leaksIn(recorder.toRecording(), [SECRET.email])).toEqual([]);
  });

  it('a resume WITHOUT the per-run policy: the leg is covered by the policy its first leg was handed', async () => {
    // The paused leg ran under a per-run `redact`; the resume does not pass it
    // again. The policy rides the run's own state into the checkpoint
    // (`AgentState.runRedaction`) and covers the resumed leg — snapshot,
    // events and recording alike, on the same instance or a fresh one.
    const build = () => {
      const ask = defineTool<{ ssn: string }, string>({
        name: 'confirm',
        description: 'ask a person to confirm the citizen',
        inputSchema: { type: 'object', properties: { ssn: { type: 'string' } }, required: ['ssn'] },
        execute: ({ ssn }) => askHuman({ question: `Is ${ssn} right?` }),
      });
      let calls = 0;
      const provider: LLMProvider = {
        name: 'pauses-then-answers',
        complete: async (): Promise<LLMResponse> => {
          calls += 1;
          return calls === 1
            ? {
                content: '',
                toolCalls: [{ id: 'p1', name: 'confirm', args: { ssn: SECRET.ssn } }],
                usage: { input: 1, output: 1 },
                stopReason: 'tool_use',
              }
            : {
                content: 'confirmed',
                toolCalls: [],
                usage: { input: 1, output: 1 },
                stopReason: 'stop',
              };
        },
      };
      // No DECLARED policy: the first leg's coverage is the per-run one only.
      return Agent.create({ provider, model: 'm' }).tool(ask).build();
    };
    const first = build();
    const outcome = await first.run({ message: MESSAGE }, { redact: conversationPolicy() });
    expect(isPaused(outcome)).toBe(true);
    if (!isPaused(outcome)) return;
    for (const agent of [first, build()]) {
      const events: AgentfootprintEvent[] = [];
      agent.on('*', (e) => events.push(e));
      const recorder = recordRun(agent);
      await agent.resume(outcome.checkpoint, { answer: 'yes' });
      // What the first leg kept out stays out of the second leg's records.
      for (const record of [agent.getLastSnapshot(), recorder.toRecording(), events]) {
        expect(leaksIn(record, [SECRET.user, SECRET.ssn])).toEqual([]);
      }
      expect(servedUnderPolicy(agent.getLastSnapshot())).toBe(true);
    }
    // A carried policy this library did not write refuses the resume — a leg
    // its policy could not keep covered must not start.
    const tampered = {
      ...outcome.checkpoint,
      sharedState: { ...outcome.checkpoint.sharedState, runRedaction: { keys: 'history' } },
    };
    await expect(build().resume(tampered, { answer: 'yes' })).rejects.toThrow(
      /Agent\.resume: the checkpoint's `runRedaction` is not a redaction policy/,
    );
  });

  it('a crash: RunCheckpointError.checkpoint carries the real conversation', async () => {
    let call = 0;
    const provider: LLMProvider = {
      name: 'crashes',
      complete: async (): Promise<LLMResponse> => {
        call += 1;
        if (call === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'c1', name: 'lookup', args: { citizenId: 'c-1', ssn: SECRET.ssn } }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        }
        throw new Error('provider fell over');
      },
    };
    const agent = Agent.create({ provider, model: 'm', redact: conversationPolicy() })
      .tool(fixtureAgentTool())
      .build();
    const failure = await agent.run({ message: MESSAGE }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RunCheckpointError);
    const checkpoint = JSON.stringify((failure as RunCheckpointError).checkpoint);
    // `history` is a selected name, and still the crash checkpoint — what
    // resumeOnError replays to the model — holds the real conversation.
    expect(checkpoint).toContain(SECRET.user);
    expect(checkpoint).toContain(SECRET.ssn);
    expect(checkpoint).toContain(SECRET.email);
  });
});

describe('the machinery that decides on events is never redacted', () => {
  /** Reports a huge count on every call and calls a tool three times. */
  function counted(): LLMProvider {
    let call = 0;
    return {
      name: 'counted',
      complete: async (): Promise<LLMResponse> => {
        call += 1;
        const wantsTool = call <= 3;
        return {
          content: wantsTool ? '' : 'FINAL',
          toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
          usage: { input: 99_999, output: 10 },
          stopReason: 'end_turn',
        };
      },
    };
  }
  const looker = defineTool({
    name: 'look',
    description: 'look something up',
    inputSchema: { type: 'object', properties: {} },
    execute: () => `RESULT ${'x'.repeat(300)}`,
  });
  function windowed(redact?: RedactionPolicy) {
    return Agent.create({ provider: counted(), model: 'm', ...(redact && { redact }) })
      .tool(looker)
      .window(tokenBudget({ thresholdTokens: 1000, keepRecentTurns: 1 }))
      .maxIterations(8)
      .build();
  }
  const compactionsOf = (agent: Agent): readonly WindowRecord[] =>
    ((agent.getLastSnapshot()?.sharedState as { compactions?: WindowRecord[] }).compactions ??
      []) as WindowRecord[];

  it('the window decides the same with a policy whose pattern masks the token count', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plain = windowed();
    await plain.run({ message: 'go' });
    const masked = windowed({ patterns: [/input/i] });
    const served: AgentfootprintEvent[] = [];
    masked.on('agentfootprint.stream.llm_end', (e) => served.push(e));
    await masked.run({ message: 'go' });
    // The pattern really bites the RECORD: the served count is the placeholder…
    expect((served[0]?.payload as { usage?: { input?: unknown } }).usage?.input).toBe('[REDACTED]');
    // …and the window, reading the real-value path, decides exactly as before.
    expect(compactionsOf(plain).length).toBeGreaterThan(0);
    expect(compactionsOf(masked).length).toBe(compactionsOf(plain).length);
  });
});

describe('a hosted agent: the reply and the session store are the caller’s', () => {
  it('streams the REAL reply, stores the REAL conversation, files a SERVED recording', async () => {
    const policy = conversationPolicy();
    const agent = fixtureAgent({ redact: policy });
    const recorder = recordRun(agent);
    const sessions = memorySessions();
    const host = inProcessHost({ streaming: true });
    const handle = await standingAgent({ agent, sessions, host, durability: 'sync' });
    try {
      const delivered = await host.deliver({ input: MESSAGE, sessionId: 's-1' });
      expect(String(delivered.output)).toContain(SECRET.answer);
      // The reply streamed to the person who asked is the real one.
      expect(delivered.chunks.join('')).toContain(SECRET.answer);
      // The session store is what the next turn resumes from: real values.
      const stored = JSON.stringify(readEnvelope(await sessions.hydrate('s-1')));
      expect(stored).toContain(SECRET.user);
      expect(stored).toContain(SECRET.email);
      // The record of the same turn is served.
      expect(leaksIn(recorder.toRecording())).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it('toSSE: "text" streams the real reply; "full" streams the served record', async () => {
    const agent = fixtureAgent({ redact: conversationPolicy() });
    const text: string[] = [];
    const full: string[] = [];
    const reading = (async () => {
      for await (const chunk of toSSE(agent, { format: 'text' })) text.push(chunk);
    })();
    const readingFull = (async () => {
      for await (const chunk of toSSE(agent)) full.push(chunk);
    })();
    await agent.run({ message: MESSAGE });
    await Promise.all([reading, readingFull]);
    expect(text.join('')).toContain(SECRET.answer);
    for (const secret of [SECRET.user, SECRET.ssn, SECRET.email, SECRET.answer]) {
      expect(full.join('')).not.toContain(secret);
    }
  });

  it('toSSE: the consumer’s filter sees the served record, in both formats', async () => {
    const agent = fixtureAgent({ redact: conversationPolicy() });
    const filtered: AgentfootprintEvent[] = [];
    const text: string[] = [];
    const reading = (async () => {
      for await (const chunk of toSSE(agent, {
        format: 'text',
        filter: (event) => {
          filtered.push(event);
          return true;
        },
      })) {
        text.push(chunk);
      }
    })();
    await agent.run({ message: MESSAGE });
    await reading;
    // The reply the person reads is real…
    expect(text.join('')).toContain(SECRET.answer);
    // …and consumer code never held a real event.
    expect(filtered.length).toBeGreaterThan(0);
    expect(leaksIn(filtered)).toEqual([]);
  });

  it('toSSE "text": the same reply, token for token, with and without a policy, inline and deferred', async () => {
    // Each token's text is matched to its served twin by its address (stage,
    // iteration, index), never by arrival order: a filter that drops tokens,
    // or a served token that never arrives, cannot shift the ones after it.
    const replyOf = async (
      redact: RedactionPolicy | undefined,
      observerDelivery: 'inline' | 'deferred',
      keep: (event: AgentfootprintEvent) => boolean,
    ) => {
      const agent = Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [{ content: `Here it is: ${SECRET.answer}, and that is all.` }],
        }),
        model: 'mock',
        maxIterations: 2,
        observerDelivery,
        ...(redact !== undefined && { redact }),
      }).build();
      const chunks: string[] = [];
      const reading = (async () => {
        for await (const chunk of toSSE(agent, { format: 'text', filter: keep }))
          chunks.push(chunk);
      })();
      await agent.run({ message: MESSAGE });
      await reading;
      return chunks;
    };
    const everyToken = () => true;
    const evenTokens = (event: AgentfootprintEvent) =>
      event.type !== 'agentfootprint.stream.token' ||
      ((event.payload as { tokenIndex: number }).tokenIndex ?? 0) % 2 === 0;
    for (const keep of [everyToken, evenTokens]) {
      const control = await replyOf(undefined, 'inline', keep);
      expect(control.length).toBeGreaterThan(2);
      for (const delivery of ['inline', 'deferred'] as const) {
        expect(await replyOf(conversationPolicy(), delivery, keep)).toEqual(control);
      }
    }
  });

  it('no runner method hands out the real values — the live taps are the library’s own', () => {
    // A consumer that could subscribe to the real-value path could wire it to a
    // store or an exporter and turn it into a record. The taps live in an
    // unexported registry (`core/runnerLive.ts`), not on the runner.
    const agent = fixtureAgent({ redact: conversationPolicy() });
    expect('onRealEvent' in agent).toBe(false);
    expect('liveState' in agent).toBe(false);
  });
});

describe('untrusted keys never fail a redacted run', () => {
  // The vocabulary declares a `fields` selector (`turnRoute`), so every agent
  // under it runs a `fields` policy. footprintjs before 9.44.1 looked a data
  // key up in `policy.fields` through the prototype chain: a model's argument
  // or a tool's result holding a key named `constructor` or `toString` failed
  // the run ("fields is not iterable"), or blanked a whole event. The floor is
  // `^9.44.1` for this.
  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: the run answers, and the record keeps its structure`, async () => {
      const hostile = () => JSON.parse('{"constructor":"c","toString":"t","valueOf":"v"}');
      const agent = Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [
            { toolCalls: [{ id: 'c1', name: 'probe', args: { id: 'x', ...hostile() } }] },
            { content: 'probed' },
          ],
        }),
        model: 'mock',
        maxIterations: 4,
        reactMode,
        redact: conversationPolicy(),
      })
        .tool(
          defineTool<Record<string, unknown>, unknown>({
            name: 'probe',
            description: 'Probe.',
            inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
            execute: () => ({ rows: [], ...hostile() }),
          }),
        )
        .build();
      const events: AgentfootprintEvent[] = [];
      agent.on('*', (e) => events.push(e));
      expect(await agent.run({ message: 'probe it' })).toBe('probed');
      const start = events.find((e) => e.type === 'agentfootprint.stream.tool_start');
      expect(start?.payload).toMatchObject({ toolName: 'probe', args: '[REDACTED]' });
    });
  }
});

/** The fixture's tool, standalone (the crash test builds its own agent). */
function fixtureAgentTool() {
  return defineTool<{ citizenId: string; ssn: string }, unknown>({
    name: 'lookup',
    description: 'Look a citizen up.',
    inputSchema: {
      type: 'object',
      properties: { citizenId: { type: 'string' }, ssn: { type: 'string' } },
      required: ['citizenId', 'ssn'],
    },
    execute: () => ({ name: 'Ada', email: SECRET.email }),
  });
}
