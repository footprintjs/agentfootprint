/**
 * deploy/around-turn — work that wraps a whole hosted turn.
 *
 * Some work has to happen around a turn rather than inside it: awaited analysis
 * before the first model call, a context that every tool and provider call can
 * read, the turn's time anchor, a record of what was prepared. Message
 * middleware cannot hold a context or set `time`, and wrapping the host's handler
 * runs before identity, admission and session ownership.
 *
 * `.aroundTurn({ name, around })` is the supported place. It runs after the
 * host's checks, on every door, and it cannot change how the turn ended:
 * `proceed()` resolves to nothing. Since 14.0.0 a hosted turn does not call a
 * replaced `agent.run`, so `standingAgent` refuses an agent that has one.
 *
 * This file is its own integration test: it serves one turn through a small
 * in-process host, so it needs no socket, and shows the prepared context
 * reaching a tool and the time reaching the run's clock. A deployment passes
 * `nodeHost` instead, and nothing else changes.
 *
 * Run:  npm run example examples/deploy/around-turn.ts
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  memorySessions,
  ReplacedRunnerMethodError,
  standingAgent,
  type AgentHost,
  type HostHandler,
} from '../../src/doors/hosting.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/around-turn',
  title: 'Work around a turn — awaited preparation, a held context, the turn’s time',
  group: 'deploy',
  description:
    'One wrapper around every top-level turn: awaited work before it, an AsyncLocalStorage its tools and provider calls can read, and the time anchor set through the same path as run({ time }). The wrapper runs after the host’s identity, admission and session checks, and it cannot change how the turn ended.',
  defaultInput: 'What is on my calendar?',
  providerSlots: ['default'],
  tags: ['hosting', 'aroundTurn', 'context', 'time'],
};

// #region around-turn
interface Prepared {
  readonly intent: string;
  readonly at: string;
}

const prepared = new AsyncLocalStorage<Prepared>();

/** Stands in for awaited work: an analysis, a routing lookup, a cache warm-up. */
async function prepareTurn(message: string): Promise<Prepared> {
  await new Promise((resolve) => setTimeout(resolve, 1));
  return {
    intent: message.includes('calendar') ? 'schedule' : 'other',
    at: '2026-03-04T05:06:07.000Z',
  };
}

function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider:
      provider ??
      mock({
        replies: [{ toolCalls: [{ id: 'one', name: 'read_intent', args: {} }] }, 'You have one.'],
      }),
    model: 'mock',
  })
    .time({ zone: 'UTC' })
    .aroundTurn({
      name: 'prepare',
      around: async (turn, proceed) => {
        // A resume keeps its paused clock and takes no change.
        if (turn.kind === 'resume') return proceed();
        const message = typeof turn.input === 'string' ? turn.input : turn.input.message;
        const work = await prepareTurn(message);
        // `proceed` runs the turn and resolves to nothing: the answer, a pause
        // and the checkpoint stay with the library.
        await prepared.run(work, () => proceed({ time: { now: work.at } }));
      },
    })
    .tool(
      defineTool({
        name: 'read_intent',
        description: 'Read what the turn was prepared with.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => prepared.getStore()?.intent ?? 'nothing prepared',
      }),
    )
    .build();
}
// #endregion around-turn

/** The smallest host: one request in, one reply out. Stands in for `nodeHost`. */
function inProcessHost(): AgentHost & { say(input: string, sessionId: string): Promise<string> } {
  let handler: HostHandler | undefined;
  return {
    name: 'in-process',
    capabilities: [],
    serve: async (incoming) => {
      handler = incoming;
      return { close: async () => undefined };
    },
    say: (input, sessionId) =>
      new Promise((resolve, reject) => {
        void handler?.({ input, sessionId }, { complete: resolve, fail: reject });
      }),
  };
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const agent = buildAgent(provider);
  const toolSaw: unknown[] = [];
  agent.on('agentfootprint.stream.tool_end', (event) => toolSaw.push(event.payload.result));
  const host = inProcessHost();
  const handle = await standingAgent({ agent, sessions: memorySessions(), host });
  try {
    const answer = await host.say(input, 'ada-1');
    const state = agent.getLastSnapshot()?.sharedState as {
      findingsLedger?: readonly { kind?: string; now?: string }[];
    };

    // The old way to do this is refused by name, so it cannot be skipped silently.
    const replaced = buildAgent(provider);
    replaced.run = replaced.run.bind(replaced);
    const refusal = await standingAgent({
      agent: replaced,
      sessions: memorySessions(),
      host: inProcessHost(),
    }).catch((error: unknown) => error);

    return {
      answer,
      toolSaw,
      clockNow: state.findingsLedger?.find((row) => row.kind === 'clock')?.now,
      replacedMethodRefused: refusal instanceof ReplacedRunnerMethodError,
    };
  } finally {
    await handle.close();
  }
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
