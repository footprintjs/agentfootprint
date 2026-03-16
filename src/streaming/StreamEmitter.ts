/**
 * StreamEmitter — publishes real-time events during agent execution.
 */

export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call_start'; toolName: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; content: string }
  | { type: 'done'; response: string }
  | { type: 'error'; message: string };

export type StreamEventHandler = (event: StreamEvent) => void;

export class StreamEmitter {
  private handlers: StreamEventHandler[] = [];

  /** Subscribe to stream events. */
  on(handler: StreamEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /** Emit a token (LLM text chunk). */
  emitToken(content: string): void {
    this.emit({ type: 'token', content });
  }

  /** Emit a thinking event (agent reasoning). */
  emitThinking(content: string): void {
    this.emit({ type: 'thinking', content });
  }

  /** Emit tool call start. */
  emitToolCallStart(toolName: string, args: Record<string, unknown>): void {
    this.emit({ type: 'tool_call_start', toolName, arguments: args });
  }

  /** Emit tool result. */
  emitToolResult(toolName: string, content: string): void {
    this.emit({ type: 'tool_result', toolName, content });
  }

  /** Emit done event. */
  emitDone(response: string): void {
    this.emit({ type: 'done', response });
  }

  /** Emit error event. */
  emitError(message: string): void {
    this.emit({ type: 'error', message });
  }

  private emit(event: StreamEvent): void {
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
 * SSEFormatter — converts StreamEvent to Server-Sent Events text.
 */
export class SSEFormatter {
  static format(event: StreamEvent): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  static formatAll(events: StreamEvent[]): string {
    return events.map(SSEFormatter.format).join('');
  }
}
