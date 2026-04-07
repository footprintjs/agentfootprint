/**
 * agentfootprint/stream — See agents work in real-time.
 *
 * 9-event discriminated union for CLI/web/mobile consumers.
 * SSEFormatter for Server-Sent Events.
 *
 * @example
 * ```typescript
 * import { SSEFormatter } from 'agentfootprint/stream';
 * import type { AgentStreamEvent } from 'agentfootprint/stream';
 *
 * await agent.run('hello', {
 *   onEvent: (e: AgentStreamEvent) => res.write(SSEFormatter.format(e)),
 * });
 * ```
 */

export { StreamEmitter, SSEFormatter } from './streaming';
export type {
  AgentStreamEvent,
  AgentStreamEventHandler,
  StreamEvent,
  StreamEventHandler,
} from './streaming';
