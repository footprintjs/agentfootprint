/**
 * adapter — AG-UI as a protocol adapter: what `streamHandler` takes to serve
 * runs to any AG-UI frontend.
 *
 * Three strategies, each replaceable on its own:
 *   - the PLAN — what an untrusted request may ask of its conversation
 *     (`request.ts`), tuned by the app's own allow-list (`frontendTools`) and
 *     validators (`accept`);
 *   - the TRANSLATION — one run's served events → AG-UI events
 *     (`agUiSerializer`, tuned by `custom` and `reasoning`), one per request;
 *   - the FRAMING — AG-UI events → bytes (`agUiSse`, `encoder` for bundles).
 *
 * Holds no state between requests: its options are read once and frozen, and
 * every request gets its own translation and its own frontend tools.
 */

import type { ProtocolAdapter } from '../hosting/protocolAdapter.js';
import { agUiSse, type AgUiEncoderModule } from './framing.js';
import {
  frontendToolBuilders,
  isFrontendToolPause,
  type AgUiFrontendTool,
} from './frontendTools.js';
import {
  planAgUiTurn,
  readAgUiRunInput,
  readAgUiSuspension,
  type AgUiValidator,
} from './request.js';
import { agUiSerializer, type AgUiSerializerOptions } from './serializer.js';
import type { AgUiEvent, AgUiRunInput } from './types.js';

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
  /** The CUSTOM allow-list — see {@link AgUiSerializerOptions.custom}. */
  readonly custom?: AgUiSerializerOptions['custom'];
  /** Write the model's reasoning — see {@link AgUiSerializerOptions.reasoning}. */
  readonly reasoning?: boolean;
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
  const { custom, reasoning, encoder } = options;
  return Object.freeze({
    name: 'ag-ui',
    readRequest: ({ body }) => readAgUiRunInput(body),
    conversation: (input) => input.threadId,
    plan: (input, held, facts) => planAgUiTurn(input, held, facts, rules),
    awaitsCaller: isFrontendToolPause,
    open: (input, resumed) => {
      const resume = resumed === undefined ? undefined : readAgUiSuspension(resumed);
      return agUiSerializer({
        threadId: input.threadId,
        runId: input.runId,
        ...(custom !== undefined && { custom }),
        ...(reasoning !== undefined && { reasoning }),
        ...(resume !== undefined && { resume }),
      });
    },
    framing: () => agUiSse(encoder === undefined ? {} : { encoder }),
  } satisfies ProtocolAdapter<AgUiRunInput, AgUiEvent>);
}
