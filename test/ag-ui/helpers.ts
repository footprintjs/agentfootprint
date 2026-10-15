/**
 * Shared helpers for the AG-UI tests: run a real runner and collect the AG-UI
 * events its served stream becomes, then hand them to the OFFICIAL client
 * (`@ag-ui/client`) — its enforcement, verification and reducer — exactly as
 * an AG-UI frontend would receive them.
 */

import { AbstractAgent, type RunAgentResult } from '@ag-ui/client';
import type { BaseEvent, Message, RunAgentInput } from '@ag-ui/core';
import { from, type Observable } from 'rxjs';

import type { AgentfootprintEvent } from '../../src/index.js';
import { agUiSerializer, type AgUiSerializerOptions } from '../../src/ag-ui/serializer.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';

/** What a runner must offer to be run here — every agentfootprint runner does. */
export interface Runnable {
  on(type: '*', listener: (event: AgentfootprintEvent) => void): () => void;
  run(input: never, options?: never): Promise<unknown>;
}

export interface AgUiRun {
  readonly events: AgUiEvent[];
  /** The agentfootprint events, as every listener (and so the serializer) received them. */
  readonly served: AgentfootprintEvent[];
  readonly out?: unknown;
  readonly error?: unknown;
}

/** Run `runner` once and collect the AG-UI events its served stream becomes. */
export async function runAsAgUi(
  runner: Runnable,
  input: unknown,
  options: {
    threadId?: string;
    runId?: string;
    runOptions?: unknown;
    serializer?: Omit<AgUiSerializerOptions, 'threadId' | 'runId'>;
  } = {},
): Promise<AgUiRun> {
  const serializer = agUiSerializer({
    threadId: options.threadId ?? 'thread-1',
    runId: options.runId ?? 'run-1',
    ...options.serializer,
  });
  const events: AgUiEvent[] = [];
  const served: AgentfootprintEvent[] = [];
  const off = runner.on('*', (event) => {
    served.push(event);
    events.push(...serializer.event(event));
  });
  try {
    const out = await runner.run(input as never, options.runOptions as never);
    const paused =
      typeof out === 'object' && out !== null && (out as { paused?: unknown }).paused === true;
    events.push(...serializer.settle({ kind: paused ? 'paused' : 'finished' }));
    return { events, served, out };
  } catch (error) {
    events.push(...serializer.settle({ kind: 'failed' }));
    return { events, served, error };
  } finally {
    off();
  }
}

/** An AG-UI agent that replays a recorded event list — the official client pipeline runs over it. */
class ReplayAgent extends AbstractAgent {
  constructor(private readonly recorded: readonly AgUiEvent[], threadId: string) {
    super({ threadId });
  }
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return from(this.recorded as unknown as BaseEvent[]);
  }
}

/**
 * Feed `events` through `@ag-ui/client`'s own pipeline (enforce → chunks →
 * verify → apply), as a frontend does. Resolves with the conversation it built;
 * rejects with the client's own refusal for a stream it does not accept.
 */
export async function replayThroughClient(
  events: readonly AgUiEvent[],
  threadId = 'thread-1',
): Promise<{ result: RunAgentResult; messages: Message[]; warnings: string[] }> {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    const agent = new ReplayAgent(events, threadId);
    const result = await agent.runAgent();
    return { result, messages: agent.messages, warnings };
  } finally {
    console.warn = warn;
  }
}

/** The event types, in order — the shape of a stream at a glance. */
export const typesOf = (events: readonly AgUiEvent[]): string[] => events.map((e) => e.type);

/** Every string anywhere in `value`, keys included. */
export function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      stringsIn(v, out);
    }
  }
  return out;
}
