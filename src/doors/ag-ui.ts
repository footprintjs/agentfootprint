/**
 * agentfootprint/ag-ui — the AG-UI protocol, spoken by any agentfootprint run.
 *
 * AG-UI is the open protocol AG-UI frontends (CopilotKit, the AG-UI Dojo, any
 * `@ag-ui/client` app) use to drive an agent: one request in, a stream of
 * typed events out. This door is the adapter over agentfootprint's own event
 * stream: `agUi()` is the protocol adapter a host serves runs in
 * (`streamHandler` on `agentfootprint/hosting`); `agUiSerializer` translates
 * one run's served events into AG-UI events, and `agUiSse` frames them with
 * the official `@ag-ui/encoder` — an optional peer, loaded only when a framing
 * is built.
 *
 * @example
 * ```ts
 * import { agUi } from 'agentfootprint/ag-ui';
 * import { streamHandler } from 'agentfootprint/hosting';
 * ```
 */

export * from '../ag-ui/index.js';
