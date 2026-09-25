/**
 * Shared harness for the `HostReply.turnArtifacts` suites — an in-process host
 * with every terminal a redemption needs, the agents the scenarios run, and the
 * helpers that file and redeem.
 *
 * The host's hook runs the request's own `onTurn` INSIDE the awaited hand-over,
 * which is the one supported way to file: the binding is live only while the
 * hook runs, and the composer ends the reply after it settles.
 */

import { expect } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts, requestInput } from '../../src/index.js';
import type { ArtifactMeta } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import {
  HostClosedError,
  IdentityNotVerifiedError,
  memorySessions,
  standingAgent,
} from '../../src/hosting/index.js';
import type {
  AgentHost,
  ArtifactWireRequest,
  ArtifactWireResult,
  HostHandle,
  HostHandler,
  HostReply,
  IdentityVerifier,
  PendingAsk,
  SessionLifecycle,
  SessionWireRequest,
  StandingAgentOptions,
  TurnArtifacts,
  VerifiedIdentity,
} from '../../src/hosting/index.js';

export const ALICE = { authorization: 'Bearer tok-alice' } as const;
export const BOB = { authorization: 'Bearer tok-bob' } as const;

/** A WELL-FORMED ref (`art_` + 22) that was never minted — "not found", not "malformed". */
export const NEVER_MINTED = `art_${'N'.repeat(22)}`;

/** Accepts two tokens; refuses everything else by class. */
export function verifier(): IdentityVerifier {
  const accepted: Record<string, VerifiedIdentity> = {
    'tok-alice': { userId: 'alice' },
    'tok-bob': { userId: 'bob' },
  };
  return {
    verify(token: string): Promise<VerifiedIdentity> {
      const found = accepted[token];
      return found === undefined
        ? Promise.reject(new IdentityNotVerifiedError('unverifiable', false))
        : Promise.resolve(found);
    },
  };
}

/** Everything a caller can observe about one delivered request. */
export interface Delivered {
  readonly output?: string;
  readonly error?: string;
  readonly code?: string;
  readonly awaiting?: PendingAsk;
  readonly artifact?: ArtifactWireResult;
  /** Every hand-over the composer made on this request. */
  readonly turns: readonly TurnArtifacts[];
  /** What the request's `onTurn` returned, once per hand-over. */
  readonly filed: readonly unknown[];
  /** The reply calls, in order — `turnArtifacts` when the hook started and
   *  `turnArtifacts:settled` when it finished, to pin "awaited, before the
   *  terminal". */
  readonly order: readonly string[];
}

export interface DeliverRequest {
  readonly input?: string;
  readonly sessionId?: string;
  /** The transport's own CLAIM (read only with no verifier configured). */
  readonly userId?: string;
  readonly decision?: unknown;
  readonly artifact?: ArtifactWireRequest;
  readonly session?: SessionWireRequest;
  readonly headers?: Readonly<Record<string, string>>;
  /** The request's own cancellation — a client that hung up. */
  readonly signal?: AbortSignal;
  /** Runs inside the awaited hand-over with this turn's value. */
  readonly onTurn?: (turn: TurnArtifacts) => unknown;
}

export type FilingHost = AgentHost & { deliver(request: DeliverRequest): Promise<Delivered> };

/**
 * An in-process host with every terminal a redemption needs (`artifact`,
 * `awaiting`) — and, unless told otherwise, the `turnArtifacts` hook.
 */
export function filingHost(options: { readonly hook?: boolean } = {}): FilingHost {
  const hook = options.hook !== false;
  let handler: HostHandler | undefined;
  let open = false;
  return {
    name: 'filingHost',
    capabilities: [],
    serve(incoming: HostHandler): Promise<HostHandle> {
      handler = incoming;
      open = true;
      return Promise.resolve({
        close: async () => {
          open = false;
        },
      });
    },
    async deliver(request: DeliverRequest): Promise<Delivered> {
      if (!open) throw new HostClosedError('filingHost');
      const turns: TurnArtifacts[] = [];
      const filed: unknown[] = [];
      const order: string[] = [];
      let settled = false;
      let result: Omit<Delivered, 'turns' | 'filed' | 'order'> = {};
      const end = (name: string, value: Omit<Delivered, 'turns' | 'filed' | 'order'>): void => {
        order.push(name);
        if (settled) return;
        settled = true;
        result = value;
      };
      const reply: HostReply = {
        complete: (output) => end('complete', { output }),
        awaiting: (pending) => end('awaiting', { awaiting: pending }),
        artifact: (artifact) => end('artifact', { artifact }),
        fail: (err) => end('fail', { error: err.message, code: (err as { code?: string }).code }),
        ...(hook && {
          turnArtifacts: async (turn: TurnArtifacts) => {
            order.push('turnArtifacts');
            turns.push(turn);
            try {
              if (request.onTurn !== undefined) filed.push(await request.onTurn(turn));
            } finally {
              order.push('turnArtifacts:settled');
            }
          },
        }),
      };
      try {
        await handler?.(
          {
            input: request.input ?? '',
            ...(request.sessionId !== undefined && { sessionId: request.sessionId }),
            ...(request.userId !== undefined && { userId: request.userId }),
            ...(request.decision !== undefined && { decision: request.decision }),
            ...(request.artifact !== undefined && { artifact: request.artifact }),
            ...(request.session !== undefined && { session: request.session }),
            ...(request.headers !== undefined && { headers: request.headers }),
            ...(request.signal !== undefined && { signal: request.signal }),
          },
          reply,
        );
      } catch (err) {
        reply.fail(err instanceof Error ? err : new Error(String(err)));
      }
      return { ...result, turns, filed, order };
    },
  };
}

/** A plain answering agent that files its own turn recording. */
export function recordingAgent(
  store = inMemoryArtifacts(),
  provider: Parameters<typeof Agent.create>[0]['provider'] = mock({ reply: 'ok' }),
): Agent {
  return Agent.create({ provider, model: 'm', artifacts: { store, recordings: true } }).build();
}

/** An agent whose one tool asks a person, then answers once resumed. */
export function pausingAgent(store = inMemoryArtifacts()): Agent {
  const approve = defineTool<{ amount: number }, string>({
    name: 'approve_refund',
    description: 'refund a customer',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
    execute: ({ amount }) => askHuman({ question: `Approve $${amount}?` }),
  });
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 10 } }] },
        { content: 'refund issued' },
      ],
    }),
    model: 'm',
    maxIterations: 3,
    artifacts: { store, recordings: true },
  })
    .system('terse')
    .tool(approve)
    .build();
}

/** An agent whose one tool asks for TWO typed values — so an answer can be partial. */
export function inputAgent(store = inMemoryArtifacts()): Agent {
  const collect = defineTool({
    name: 'collect',
    description: 'Collect input.',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      requestInput({
        id: 'input',
        question: 'Year and region?',
        fields: [
          { id: 'year', type: 'number' },
          { id: 'region', type: 'string' },
        ],
      }),
  });
  return Agent.create({
    provider: mock({ replies: [{ toolCalls: [{ id: 'collect', name: 'collect', args: {} }] }] }),
    model: 'm',
    artifacts: store,
  })
    .tool(collect)
    .build();
}

/**
 * A mock provider whose NEXT call can be held open until released — so a test
 * can act while one person's run is in flight on a shared agent.
 */
export function gatedProvider(reply = 'ok') {
  const inner = mock({ reply });
  let armed = false;
  let opened: () => void = () => undefined;
  let waitFor: Promise<void> = Promise.resolve();
  const hold = async (): Promise<void> => {
    if (!armed) return;
    armed = false;
    opened();
    await waitFor;
  };
  const provider = new Proxy(inner, {
    get(target, prop) {
      const original = Reflect.get(target, prop, target) as unknown;
      if (prop === 'complete' && typeof original === 'function') {
        return async (...args: unknown[]) => {
          await hold();
          return (original as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (prop === 'stream' && typeof original === 'function') {
        return async function* (...args: unknown[]) {
          await hold();
          yield* (original as (...a: unknown[]) => AsyncIterable<unknown>).apply(target, args);
        };
      }
      return original;
    },
  });
  return {
    provider,
    /** Hold the next call: resolves `started` once it is in flight. */
    arm(): { started: Promise<void>; release: () => void } {
      armed = true;
      let release: () => void = () => undefined;
      waitFor = new Promise<void>((resolve) => (release = resolve));
      const started = new Promise<void>((resolve) => (opened = resolve));
      return { started, release: () => release() };
    },
  };
}

export interface ArtifactMintedFact {
  readonly ref: string;
  readonly kind: string;
  readonly bytes: number;
  readonly label?: string;
  readonly digest?: string;
  readonly tool?: string;
  readonly origin?: { readonly runId?: string; readonly toolCallId?: string };
}

/** The `recording/run` tickets the agent filed, in order. */
export function recordingsOf(agent: Agent): () => ArtifactMintedFact[] {
  const seen: ArtifactMintedFact[] = [];
  agent.on('agentfootprint.artifacts.minted', (event: AgentfootprintEvent) => {
    const payload = event.payload as ArtifactMintedFact;
    if (payload.kind === 'recording/run') seen.push(payload);
  });
  return () => seen;
}

/** Every `artifacts.*` event on the agent, with its meta. */
export function artifactEventsOf(agent: Agent): () => AgentfootprintEvent[] {
  const seen: AgentfootprintEvent[] = [];
  agent.on('agentfootprint.artifacts.*', (event: AgentfootprintEvent) => seen.push(event));
  return () => seen;
}

export interface ServeOptions {
  readonly verify?: boolean;
  readonly allowAnonymous?: boolean;
  readonly hook?: boolean;
  readonly sessions?: SessionLifecycle;
  readonly extra?: Partial<StandingAgentOptions<HostHandle>>;
}

/** One suite's servers, closed after each test. */
export function harness() {
  const closers: Array<() => Promise<void>> = [];

  async function served(
    target: Agent | { readonly agentFactory: () => Agent; readonly maxActiveSessions?: number },
    options: ServeOptions = {},
  ): Promise<{ host: FilingHost; sessions: SessionLifecycle }> {
    const host = filingHost({ hook: options.hook });
    const sessions = options.sessions ?? memorySessions();
    const handle = await standingAgent({
      ...(target instanceof Agent ? { agent: target } : target),
      sessions,
      host,
      ...(options.verify === true && {
        identity: {
          verify: verifier().verify,
          ...(options.allowAnonymous === true && { allowAnonymous: true }),
        },
      }),
      ...(options.extra as object),
    } as StandingAgentOptions<HostHandle>);
    closers.push(() => handle.close());
    return { host, sessions };
  }

  async function closeAll(): Promise<void> {
    await Promise.allSettled(closers.map((close) => close()));
    closers.length = 0;
  }

  return { served, closeAll };
}

/** The one hand-over a turn made — or a test failure naming why not. */
export function boundOf(delivered: Delivered): Extract<TurnArtifacts, { bound: true }> {
  expect(delivered.turns).toHaveLength(1);
  const turn = delivered.turns[0];
  if (turn === undefined || !turn.bound) {
    throw new Error(`expected a bound hand-over, got ${JSON.stringify(turn)}`);
  }
  return turn;
}

/** An `onTurn` that files one small story through the hand-over — the way a
 *  host files a turn's story — and returns its ticket. */
export function fileStory(label = 'turn story', extra: object = {}) {
  return (turn: TurnArtifacts): Promise<ArtifactMeta> | undefined =>
    turn.bound
      ? turn.artifacts.put({
          kind: 'story/turn',
          mediaType: 'application/json',
          data: { beats: ['asked', 'answered'], label },
          label,
          ...(extra as Record<string, never>),
        })
      : undefined;
}

/** The ticket the request's `onTurn` filed — or a test failure. */
export function filedOf(delivered: Delivered): ArtifactMeta {
  expect(delivered.filed).toHaveLength(1);
  const meta = delivered.filed[0] as ArtifactMeta | undefined;
  if (meta === undefined) throw new Error(`nothing was filed: ${JSON.stringify(delivered)}`);
  return meta;
}

export function redeem(
  host: FilingHost,
  sessionId: string,
  ref: string,
  headers?: Readonly<Record<string, string>>,
  userId?: string,
): Promise<Delivered> {
  return host.deliver({
    sessionId,
    artifact: { op: 'get', ref },
    ...(headers !== undefined && { headers }),
    ...(userId !== undefined && { userId }),
  });
}

/** A redeemed artifact's payload as text — how the leak checks read a recording. */
export function textOf(delivered: Delivered): string {
  const data = (delivered.artifact as { data?: unknown } | undefined)?.data;
  return typeof data === 'string' ? data : JSON.stringify(data ?? delivered.error ?? null);
}

/** A refusal's words with the ref taken out — "same not-found" means THIS. */
export const withoutRef = (delivered: Delivered, ref: string) => ({
  code: delivered.code,
  error: delivered.error?.split(ref).join('<ref>'),
});

/** Collect unhandled promise rejections for the duration of `work`. */
export async function unhandledDuring(work: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const listener = (reason: unknown): void => void seen.push(reason);
  const prior = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', listener);
  try {
    await work();
    // Let any stray rejection surface: Node reports them after the microtask
    // queue drains, so a macrotask boundary is the honest wait.
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.removeListener('unhandledRejection', listener);
    for (const l of prior) process.on('unhandledRejection', l as (...args: unknown[]) => void);
  }
  return seen;
}

/** A store whose `put` for the matching input NEVER settles — a hung bucket. */
export function hangingStore(
  hangWhen: (scope: { readonly principal?: string }, input: { readonly kind: string }) => boolean,
): ReturnType<typeof inMemoryArtifacts> {
  const inner = inMemoryArtifacts();
  return new Proxy(inner, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      if (prop === 'put') {
        return (scope: { principal?: string }, input: { kind: string }) =>
          hangWhen(scope, input)
            ? new Promise(() => undefined)
            : (value as (...a: unknown[]) => unknown).call(target, scope, input);
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/** A store whose `put` takes `ms` for the matching input — a slow bucket. */
export function slowStore(
  ms: number,
  when: (input: { readonly kind: string }) => boolean = () => true,
): ReturnType<typeof inMemoryArtifacts> {
  const inner = inMemoryArtifacts();
  return new Proxy(inner, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      if (prop === 'put') {
        return async (scope: unknown, input: { kind: string }) => {
          if (when(input)) await new Promise((resolve) => setTimeout(resolve, ms));
          return (value as (...a: unknown[]) => unknown).call(target, scope, input);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/** Settles `promise` or gives up after `ms` — "is it still pending?" as data. */
export function within<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ readonly settled: true; readonly value: T } | { readonly settled: false }> {
  return Promise.race([
    promise.then((value) => ({ settled: true as const, value })),
    new Promise<{ settled: false }>((resolve) => setTimeout(() => resolve({ settled: false }), ms)),
  ]);
}

/** A redeemed recording's events, parsed. */
export async function recordingEvents(
  host: FilingHost,
  sessionId: string,
  ref: string,
  headers?: Readonly<Record<string, string>>,
): Promise<
  Array<{
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly meta: Record<string, unknown>;
  }>
> {
  const got = await redeem(host, sessionId, ref, headers);
  if (got.error !== undefined) throw new Error(`recording not redeemable: ${got.error}`);
  const data = (got.artifact as { data?: unknown } | undefined)?.data;
  const parsed = JSON.parse(typeof data === 'string' ? data : JSON.stringify(data)) as {
    events: Array<{
      type: string;
      payload: Record<string, unknown>;
      meta: Record<string, unknown>;
    }>;
  };
  return parsed.events;
}
