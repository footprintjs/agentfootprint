/**
 * Shared helpers for the AG-UI tests: run a real runner and collect the AG-UI
 * events its served stream becomes, then hand them to the OFFICIAL client
 * (`@ag-ui/client`) — its enforcement, verification and reducer — exactly as
 * an AG-UI frontend would receive them.
 */

import { AbstractAgent, type RunAgentResult } from '@ag-ui/client';
import type { BaseEvent, Message, ResumeEntry, RunAgentInput } from '@ag-ui/core';
import { from, type Observable } from 'rxjs';

import type { AgentfootprintEvent } from '../../src/index.js';
import {
  agUiSerializer,
  type AgUiSerializerOptions,
  type AgUiTranslation,
} from '../../src/ag-ui/serializer.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';

/** What a runner must offer to be run here — every agentfootprint runner does. */
export interface Runnable {
  on(type: '*', listener: (event: AgentfootprintEvent) => void): () => void;
  run(input: never, options?: never): Promise<unknown>;
  resume?(checkpoint: never, input?: never, options?: never): Promise<unknown>;
}

export interface AgUiRun {
  readonly events: AgUiEvent[];
  /** The translation itself — `suspension()` after a pause. */
  readonly translation: AgUiTranslation;
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
    /** On whom a pause waits — `'caller'` for a tool the client runs. */
    awaiting?: 'person' | 'caller';
    /** Continue a paused run instead of starting one: `runner.resume(checkpoint, answer)`. */
    resume?: { readonly checkpoint: unknown; readonly answer: unknown };
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
    const out =
      options.resume === undefined
        ? await runner.run(input as never, options.runOptions as never)
        : await runner.resume!(
            options.resume.checkpoint as never,
            options.resume.answer as never,
            options.runOptions as never,
          );
    const paused =
      typeof out === 'object' && out !== null && (out as { paused?: unknown }).paused === true;
    events.push(
      ...serializer.settle(
        paused
          ? {
              kind: 'paused',
              ...(options.awaiting !== undefined && { awaiting: options.awaiting }),
            }
          : { kind: 'finished' },
      ),
    );
    return { events, served, out, translation: serializer };
  } catch (error) {
    events.push(...serializer.settle({ kind: 'failed' }));
    return { events, served, error, translation: serializer };
  } finally {
    off();
  }
}

/** An AG-UI agent that replays recorded runs, one per `runAgent` — the official client pipeline runs over each. */
class ReplayAgent extends AbstractAgent {
  private readonly queue: (readonly AgUiEvent[])[];
  constructor(recorded: readonly (readonly AgUiEvent[])[], threadId: string) {
    super({ threadId });
    this.queue = [...recorded];
  }
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return from((this.queue.shift() ?? []) as unknown as BaseEvent[]);
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
    const agent = new ReplayAgent([events], threadId);
    const result = await agent.runAgent();
    return { result, messages: agent.messages, warnings };
  } finally {
    console.warn = warn;
  }
}

/** One run of a thread, as the client continues it: what the app adds first, and its resume answers. */
export interface ReplayedRun {
  readonly events: readonly AgUiEvent[];
  /** Messages the application adds before this run — a frontend tool's result. */
  readonly add?: readonly Message[];
  /** Answers to the interrupts the previous run ended with. */
  readonly resume?: readonly ResumeEntry[];
}

/**
 * Feed several runs of ONE thread through one client, in order — the way a
 * frontend continues a thread: the conversation, the pending interrupts and
 * the frontend tool calls carry from run to run, and the client's own rules
 * (answer every pending interrupt) apply.
 */
export async function replayRunsThroughClient(
  runs: readonly ReplayedRun[],
  threadId = 'thread-1',
): Promise<{ results: RunAgentResult[]; messages: Message[]; warnings: string[] }> {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    const agent = new ReplayAgent(
      runs.map((run) => run.events),
      threadId,
    );
    const results: RunAgentResult[] = [];
    for (const run of runs) {
      for (const message of run.add ?? []) agent.addMessage(message);
      results.push(
        await agent.runAgent(run.resume === undefined ? undefined : { resume: [...run.resume] }),
      );
    }
    return { results, messages: agent.messages, warnings };
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
