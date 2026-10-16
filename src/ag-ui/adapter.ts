/**
 * adapter — AG-UI as a protocol adapter: what `streamHandler` takes to serve
 * runs to any AG-UI frontend — or to a gateway that speaks AG-UI in its own
 * request body and its own envelope.
 *
 * Three strategies, each replaceable on its own, around one CORE that is not:
 *   - the READER — a request body → the turn it asks for (`reader`; default:
 *     the body is a `RunAgentInput`). Mapping only;
 *   - the TRANSLATION — one run's served events → AG-UI events (`translation`;
 *     default `agUiSerializer`, tuned by `custom` and `reasoning`), one per
 *     request;
 *   - the FRAMING — AG-UI events → bytes (`framing`; default `agUiSse`,
 *     `encoder` for bundles). The host numbers each stream's frames and hands
 *     the number to the framing, so a gateway envelope's sequence is per run.
 *   - the CORE (`request.ts`), whichever reader ran: the request's shape and
 *     ids checked as plain JSON, a system/developer message refused, frontend
 *     tools only by the app's allow-list, `state`/`context` only through the
 *     app's validators (`accept`), an answer only for the pause the server
 *     keeps. No strategy can reach past it.
 *
 * Holds no state between requests: its options are read once and frozen, and
 * every request gets its own translation and its own frontend tools.
 */

import type { ProtocolAdapter, RunTranslation } from '../hosting/protocolAdapter.js';
import type { SseFraming } from '../hosting/stream.js';
import { agUiSse, type AgUiEncoderModule } from './framing.js';
import {
  frontendToolBuilders,
  isFrontendToolPause,
  type AgUiFrontendTool,
} from './frontendTools.js';
import {
  planAgUiTurn,
  readAgUiRequest,
  readAgUiSuspension,
  runAgentInputReader,
  type AgUiRequestReader,
  type AgUiValidator,
} from './request.js';
import { agUiSerializer, type AgUiSerializerOptions } from './serializer.js';
import type { AgUiEvent, AgUiRunInput, AgUiSuspension } from './types.js';

/** What a translation is opened with — one run's ids, and the pause it continues. */
export interface AgUiTranslationRun {
  /** The conversation the request named (already format-checked). */
  readonly threadId: string;
  /** The run id the request named (already format-checked). */
  readonly runId: string;
  /** The paused run this one continues — its translation's `suspension()`, as the server kept it. */
  readonly resume?: AgUiSuspension;
}

/**
 * The translation strategy: opens ONE run's translation — the run's served
 * events → AG-UI events. Default: `agUiSerializer`. Called once per request;
 * a translation it returns is fed only that request's run. One that pauses
 * hands out an `AgUiSuspension` from `suspension()`, or the core cannot match
 * the next request's answer to the pause and refuses it.
 */
export type AgUiTranslationStrategy = (run: AgUiTranslationRun) => RunTranslation<AgUiEvent>;

/** Options for {@link agUi}. */
export interface AgUiOptions {
  /**
   * The tools a page may run, allow-listed by NAME with the app's own contract
   * (description, input schema) — never the page's. A request that declares a
   * tool not listed here is refused by name; one listed here and declared by
   * the page is handed to the agent factory (`StreamRunContext.tools`) for that
   * request. Needs a host that keeps the paused run (`threads` + `sessions`).
   */
  readonly frontendTools?: Readonly<Record<string, AgUiFrontendTool>>;
  /**
   * The page's `state` and `context` reach the agent only through these: each
   * gets the value and the bound thread, and returns what the agent is given
   * (`StreamRunContext.accepted`) — or throws a `WireRequestRefusal`. Without
   * one, a request carrying a non-empty value is refused by name.
   */
  readonly accept?: {
    readonly state?: AgUiValidator;
    readonly context?: AgUiValidator;
  };
  /**
   * How a request body becomes the turn it asks for ({@link AgUiRequestReader}).
   * Default: the body is an AG-UI `RunAgentInput`. A gateway that sends its own
   * body passes a reader that maps it. The reader only MAPS: what it produces is
   * checked by the same core as a `RunAgentInput` — shape and ids, no system or
   * developer message, frontend tools by `frontendTools`, `state`/`context` by
   * `accept`, an answer only for the pause the server keeps.
   */
  readonly reader?: AgUiRequestReader;
  /**
   * How one run's served events become AG-UI events ({@link AgUiTranslationStrategy}).
   * Default: `agUiSerializer` with `custom` and `reasoning`. Refused together
   * with either, which tune the default only.
   */
  readonly translation?: AgUiTranslationStrategy;
  /** The CUSTOM allow-list — see {@link AgUiSerializerOptions.custom}. */
  readonly custom?: AgUiSerializerOptions['custom'];
  /** Write the model's reasoning — see {@link AgUiSerializerOptions.reasoning}. */
  readonly reasoning?: boolean;
  /**
   * How each AG-UI event is written ({@link SseFraming}). Default: `agUiSse()`,
   * the official `@ag-ui/encoder`'s frames. A gateway that expects its own
   * envelope passes a framing that writes it; the frame's number in its stream
   * arrives as `frame(event, { sequence })`, counted by the host per stream —
   * keep no counter in the framing. Refused together with `encoder`, which
   * feeds the default only.
   */
  readonly framing?: SseFraming<AgUiEvent>;
  /** `@ag-ui/encoder`, imported by you — for a bundle this package cannot load it in. */
  readonly encoder?: AgUiEncoderModule;
}

/**
 * The AG-UI protocol adapter. Hand it to a host:
 *
 * @example
 * ```ts
 * import { memorySessions, streamHandler } from 'agentfootprint/hosting';
 * import { agUi } from 'agentfootprint/ag-ui';
 *
 * export const POST = streamHandler({
 *   agent: ({ tools }) => Agent.create({ provider, model }).tools([...mine, ...tools]).build(),
 *   adapter: agUi(),
 *   threads: { bind: ({ conversation, headers }) => bindToSignedInUser(conversation, headers) },
 *   sessions: memorySessions(),
 * });
 * ```
 *
 * @throws TypeError at construction for a frontend tool whose name or contract
 *   is not usable, and a validator that is not a function.
 */
export function agUi(options: AgUiOptions = {}): ProtocolAdapter<AgUiRunInput, AgUiEvent> {
  const frontendTools = frontendToolBuilders(options.frontendTools);
  const accept = Object.freeze({ ...options.accept });
  for (const [name, validator] of Object.entries(accept)) {
    if (validator !== undefined && typeof validator !== 'function')
      throw new TypeError(`agUi(): accept.${name} must be a function.`);
  }
  const rules = Object.freeze({ frontendTools, accept });
  const reader = strategy(options.reader, 'reader') ?? runAgentInputReader;
  const translate = translationOf(options);
  const framing = framingOf(options);
  return Object.freeze({
    name: 'ag-ui',
    readRequest: ({ body, headers }) => readAgUiRequest(reader, { body, headers }),
    conversation: (input) => input.threadId,
    plan: (input, held, facts) => planAgUiTurn(input, held, facts, rules),
    awaitsCaller: isFrontendToolPause,
    open: (input, resumed) => {
      const resume = resumed === undefined ? undefined : readAgUiSuspension(resumed);
      return translate({
        threadId: input.threadId,
        runId: input.runId,
        ...(resume !== undefined && { resume }),
      });
    },
    framing,
  } satisfies ProtocolAdapter<AgUiRunInput, AgUiEvent>);
}

/** A strategy option: absent, or a function — anything else refused by name. */
function strategy<T>(value: T | undefined, name: string): T | undefined {
  if (value !== undefined && typeof value !== 'function')
    throw new TypeError(`agUi(): ${name} must be a function.`);
  return value;
}

/** The translation strategy — the app's, or `agUiSerializer` tuned by `custom` and `reasoning`. */
function translationOf(options: AgUiOptions): AgUiTranslationStrategy {
  const { custom, reasoning } = options;
  const translation = strategy(options.translation, 'translation');
  if (translation !== undefined) {
    if (custom !== undefined || reasoning !== undefined)
      throw new TypeError(
        'agUi(): `translation` was given with `custom` or `reasoning`, which tune the default ' +
          'translation only — your translation decides both itself. Pass one or the other.',
      );
    // One translation, one run: a strategy that hands one back twice would
    // write one run's open messages and ids into another run's stream.
    const opened = new WeakSet<object>();
    return (run) => {
      const opening = translation(run);
      if (typeof opening !== 'object' || opening === null || opened.has(opening))
        throw new TypeError(
          'agUi(): `translation` must return a NEW translation for every run — one it returned ' +
            "before would carry another run's state into this one.",
        );
      opened.add(opening);
      return opening;
    };
  }
  return (run) =>
    agUiSerializer({
      ...run,
      ...(custom !== undefined && { custom }),
      ...(reasoning !== undefined && { reasoning }),
    });
}

/** The framing strategy — the app's, or `agUiSse` (with the `encoder` the app imported). */
function framingOf(options: AgUiOptions): () => SseFraming<AgUiEvent> {
  const { framing, encoder } = options;
  if (framing === undefined) return () => agUiSse(encoder === undefined ? {} : { encoder });
  if (encoder !== undefined)
    throw new TypeError(
      'agUi(): `framing` was given with `encoder`, which feeds the default framing only — ' +
        'your framing writes its own frames. Pass one or the other.',
    );
  if (
    typeof framing !== 'object' ||
    framing === null ||
    typeof framing.frame !== 'function' ||
    typeof framing.contentType !== 'string'
  )
    throw new TypeError('agUi(): `framing` must be an SseFraming — { contentType, frame }.');
  return () => framing;
}
