/**
 * agentfootprint/observe — everything that watches.
 *
 * One door for the whole watching story, which used to be nine:
 *
 *   • Recorders          — the Tier 1/2/3 observers, `recordRun`, the
 *                          offline `Trace`, the context ledger.
 *   • Diagnosis          — influence scoring, trace toolpack, context-bisect,
 *                          tool lint, and the pluggable context-error finders.
 *   • Vendor sinks       — AgentCore / CloudWatch / X-Ray / OTel strategies,
 *                          plus the tamper-evident audit export.
 *   • Strategy ports     — the observability / cost / live-status / lens
 *                          interfaces and their `attach*` helpers.
 *   • Delivery           — `toSSE` and friends, for streaming a run to a
 *                          browser.
 *   • Status + words     — the chat-bubble state machine AND the message
 *                          catalogs it renders with. The logic and the prose
 *                          are one story, so they are one door.
 *
 * The typed event stream those observers consume is its own door,
 * `agentfootprint/events` — it is the wire vocabulary, not a watching tool.
 *
 * @example
 * ```ts
 * import { recordRun, toolChoiceRecorder, selectStatus } from 'agentfootprint/observe';
 * ```
 */

export * from '../observe.js';
export * from '../observability-providers.js';
export * from '../strategies/index.js';
export * from '../stream.js';
export * from '../status.js';
export * from '../debug.js';
export * from '../debug/finders.js';
export * from '../locales/index.js';
