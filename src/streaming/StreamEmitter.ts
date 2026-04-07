import type { AgentPhase } from '../core';

/**
 * AgentStreamEvent — real-time events emitted during agent execution.
 *
 * The framework emits these. The consumer renders them (CLI, web, mobile).
 * Events fire regardless of streaming mode — only `token` and `thinking`
 * require `.streaming(true)`. Tool and turn lifecycle events always fire.
 *
 * @example
 * ```typescript
 * agent.run('hello', {
 *   onEvent: (event) => {
 *     switch (event.type) {
 *       case 'token': process.stdout.write(event.content); break;
 *       case 'tool_start': console.log(`Running ${event.toolName}...`); break;
 *       case 'tool_end': console.log(`Done (${event.latencyMs}ms)`); break;
 *     }
 *   },
 * });
 * ```
 */
export type AgentStreamEvent =
  | { type: 'turn_start'; userMessage: string }
  | { type: 'llm_start'; iteration: number }
  | { type: 'thinking'; content: string }
  | { type: 'token'; content: string }
  | {
      type: 'llm_end';
      iteration: number;
      toolCallCount: number;
      content: string;
      model?: string;
      latencyMs: number;
    }
  | { type: 'tool_start'; toolName: string; toolCallId: string; args: Record<string, unknown> }
  | {
      type: 'tool_end';
      toolName: string;
      toolCallId: string;
      /** Raw tool result — may contain PII. Apply your own redaction before logging/displaying. */
      result: string;
      error?: boolean;
      latencyMs: number;
    }
  | { type: 'turn_end'; content: string; iterations: number; paused?: boolean }
  | { type: 'error'; phase: AgentPhase; message: string };

export type AgentStreamEventHandler = (event: AgentStreamEvent) => void;

/**
 * StreamEmitter — dispatches AgentStreamEvents to consumers.
 *
 * Error isolation: handler errors are swallowed — never break the agent pipeline.
 * This is the correct behavior for a push-to-consumer system (same as RecorderBridge).
 */
export class StreamEmitter {
  private handlers: AgentStreamEventHandler[] = [];

  on(handler: AgentStreamEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  emit(event: AgentStreamEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Swallow handler errors — never break the pipeline
      }
    }
  }
}

/**
 * SSEFormatter — converts AgentStreamEvent to Server-Sent Events text.
 *
 * @example
 * ```typescript
 * res.write(SSEFormatter.format({ type: 'token', content: 'Hello' }));
 * // event: token\ndata: {"type":"token","content":"Hello"}\n\n
 * ```
 */
export class SSEFormatter {
  static format(event: AgentStreamEvent): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  static formatAll(events: AgentStreamEvent[]): string {
    return events.map(SSEFormatter.format).join('');
  }
}

// ── Backward compat aliases ─────────────────────────────────
/** @deprecated Use AgentStreamEvent instead. */
export type StreamEvent = AgentStreamEvent;
/** @deprecated Use AgentStreamEventHandler instead. */
export type StreamEventHandler = AgentStreamEventHandler;
