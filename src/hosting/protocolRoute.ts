/** Protocol strategy on the existing HTTP/standing host; no second session owner. */
import { copyJson } from '../lib/boundedJson.js';
import type { AgentfootprintEvent } from '../events/registry.js';
import type { HttpWire, StreamFrame, StreamFraming } from './httpHost.js';
import type {
  HeldConversation,
  HostedProtocolRequest,
  PlanFacts,
  ProtocolAdapter,
  ProtocolPlan,
  ProtocolTurn,
  RunRefusal,
  RunTranslation,
} from './protocolAdapter.js';
import type { HostRequest, PausedWire } from './types.js';
import { hostRefusalCode } from './refusalStatus.js';
import { WireRequestRefusal } from './errors.js';

/** One additional HTTP path, created by protocolRoute. */
export interface HttpProtocolRoute {
  readonly path: string;
  /** The protocol strategy; execution and retention remain the standing host's. */
  readonly strategy: 'standing';
  readonly maxBodyBytes: number;
  readonly wire: HttpWire;
}

/** Configuration for an event protocol sharing an existing standing host. */
export interface ProtocolRouteOptions<TRequest, TEvent> {
  readonly path: string;
  readonly adapter: ProtocolAdapter<TRequest, TEvent>;
  /** Maximum request bytes, additionally capped by the host if configured. Default 1 MiB. */
  readonly maxBodyBytes?: number;
  /** Maximum encoded event bytes. Default 256 KiB. */
  readonly maxEventBytes?: number;
  /** Maximum encoded response bytes, plus one fixed terminal refusal. Default 8 MiB. */
  readonly maxStreamBytes?: number;
}

interface Exchange {
  plan(held: HeldConversation, facts: PlanFacts): ProtocolPlan;
  suspension(): PausedWire | undefined;
}
const exchanges = new WeakMap<HostedProtocolRequest, Exchange>();

/** Plan only after the standing host has authenticated and hydrated the owned session. */
export function planHostedProtocol(
  request: HostRequest,
  held: HeldConversation,
  facts: PlanFacts,
): HostRequest {
  if (request.protocol === undefined) return request;
  const exchange = exchanges.get(request.protocol);
  if (exchange === undefined)
    throw new TypeError('The protocol request was not created by protocolRoute.');
  const plan = exchange.plan(held, facts);
  return {
    ...request,
    input: plan.turn.kind === 'message' ? plan.turn.message : '',
    ...(plan.turn.kind === 'answer' && { decision: plan.turn.answer }),
  };
}

/** Capture the wire's pause record before native persistence. */
export function protocolSuspension(request: HostRequest): PausedWire | undefined {
  return request.protocol === undefined ? undefined : exchanges.get(request.protocol)?.suspension();
}

/**
 * Add an event protocol to httpHost without replacing its standingAgent owner.
 * Each request gets one translation and framing counter; the existing pool,
 * identity, admission, lane, checkpoint and artifact rules remain authoritative.
 * Per-request frontend tool declarations are explicitly refused in this strategy.
 * Root answer text is released by complete(output), after host policy and persistence.
 * CUSTOM reply data must be app-authorized and passes the adapter's allow-list;
 * it is delivery, not a claim that the recording contained that data.
 */
export function protocolRoute<TRequest, TEvent>(
  options: ProtocolRouteOptions<TRequest, TEvent>,
): HttpProtocolRoute {
  const { path, adapter } = options;
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?') || path.includes('#'))
    throw new TypeError('protocolRoute: path must be an absolute path without query or fragment.');
  const limit = (value: number | undefined, fallback: number): number => {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
      throw new TypeError('protocolRoute: delivery limits must be positive safe integers.');
    return value ?? fallback;
  };
  const maxBodyBytes = limit(options.maxBodyBytes, 1_048_576);
  const maxEventBytes = limit(options.maxEventBytes, 262_144);
  const maxStreamBytes = limit(options.maxStreamBytes, 8_388_608);
  const encoding = adapter.framing(); // Optional peers fail at construction, before serving.
  const requests = new WeakMap<object, StreamFraming>();
  const wire: HttpWire = {
    readRequest(facts) {
      const input = adapter.readRequest(facts);
      let accepted: Readonly<Record<string, unknown>> = Object.freeze({});
      let translation: RunTranslation<TEvent> | undefined;
      let opened = false;
      let planned: ProtocolTurn | undefined;
      let encodedBytes = 0;
      let terminalRefusal = false;
      let sequence = 0;
      const bytes = new WeakMap<StreamFrame, string>();
      const protocol: HostedProtocolRequest = Object.freeze({
        name: adapter.name,
        strategy: 'standing',
        input,
        get turn() {
          return planned;
        },
        get accepted() {
          return accepted;
        },
      });
      const getTranslation = () =>
        (translation ??= adapter.open(input, undefined, { delivery: 'host' }));
      const frames = (events: readonly TEvent[]): readonly StreamFrame[] => {
        const batch = events.map((data) => ({ event: '', data }));
        const encoded = batch.map((frame, i) =>
          encoding.frame(frame.data, { sequence: sequence + i + 1 }),
        );
        const sizes = encoded.map((text) => new TextEncoder().encode(text).length);
        const size = sizes.reduce((sum, next) => sum + next, 0);
        if (
          !terminalRefusal &&
          (sizes.some((next) => next > maxEventBytes) || encodedBytes + size > maxStreamBytes)
        )
          throw new WireRequestRefusal(
            'ERR_STREAM_LIMIT',
            'The stream exceeded its configured delivery limit.',
          );
        if (terminalRefusal && size > 16_384)
          throw new TypeError('The protocol refusal exceeded its fixed delivery reserve.');
        batch.forEach((frame, i) => bytes.set(frame, encoded[i]!));
        sequence += batch.length;
        encodedBytes += size;
        return batch;
      };
      exchanges.set(protocol, {
        plan(held, at) {
          if (opened) throw new TypeError('A protocol request can only be planned once.');
          opened = true;
          const plan = adapter.plan(input, held, at);
          if ((plan.tools?.length ?? 0) > 0)
            throw new WireRequestRefusal(
              'ERR_FRONTEND_TOOLS_UNSUPPORTED',
              'The standing hosting strategy does not support per-request frontend tools.',
            );
          planned = copyJson(plan.turn, maxBodyBytes + 4096, true) as ProtocolTurn;
          accepted = Object.freeze({ ...plan.accepted });
          translation = adapter.open(input, held.awaiting?.suspension, { delivery: 'host' });
          return plan;
        },
        suspension() {
          const record = translation?.suspension?.();
          return record === undefined ? undefined : { protocol: adapter.name, record };
        },
      });
      requests.set(facts, {
        chunk: () => [], // Root live text is not protocol delivery authority.
        event: (event: AgentfootprintEvent) => frames(getTranslation().event(event)),
        custom: (name, payload) => frames(getTranslation().publish?.(name, payload) ?? []),
        complete: (output) => frames(getTranslation().settle({ kind: 'finished', output })),
        awaiting: () => frames(getTranslation().settle({ kind: 'paused' })),
        failure(_message, code) {
          terminalRefusal = true;
          const refusal: RunRefusal | undefined =
            hostRefusalCode(code) ??
            (code === 'ERR_FRONTEND_TOOLS_UNSUPPORTED' || code === 'ERR_STREAM_LIMIT'
              ? code
              : undefined);
          const closing = getTranslation().settle({
            kind: 'failed',
            ...(refusal !== undefined && { refusal }),
          });
          return frames(
            closing.length > 0
              ? closing
              : refusal === undefined
              ? []
              : adapter.refusal?.(input, refusal) ?? [],
          );
        },

        encode(frame) {
          const encoded = bytes.get(frame);
          if (encoded === undefined) throw new TypeError('The protocol frame was not prepared.');
          return encoded;
        },
      });
      return { input: '', sessionId: adapter.conversation(input), protocol };
    },
    wantsStream: () => true,
    stream: (facts) => {
      const request = requests.get(facts);
      if (request === undefined)
        throw new TypeError('The protocol request was not read before streaming.');
      return request;
    },
    health: () => ({ status: 'ok' }),
    output: (output) => ({ output }),
    chunk: () => ({}),
    awaiting: (pending) => ({ pending }),
    failure: (_message, code) => ({
      error: 'The protocol request failed.',
      ...(code !== undefined && { code }),
    }),
  };
  return Object.freeze({ path, strategy: 'standing', maxBodyBytes, wire });
}
