/**
 * PermissionRecorder — AgentRecorder that captures permission gate events.
 *
 * Tracks both layers of gatedTools defense-in-depth:
 *   1. resolve: tools filtered out (LLM never saw them)
 *   2. execute: tool calls rejected (hallucinated/injected tool name)
 *
 * Integrates with gatedTools via the onBlocked callback — events
 * are captured DURING traversal (not post-processing).
 *
 * Also captures successful tool calls via onToolCall to give a
 * complete picture: what was allowed, what was blocked, what was denied.
 *
 * Usage:
 *   const permRecorder = new PermissionRecorder();
 *
 *   const gated = gatedTools(inner, checker, {
 *     onBlocked: permRecorder.onBlocked,  // Wire the bridge
 *   });
 *
 *   const agent = Agent.create({ provider })
 *     .toolProvider(gated)
 *     .recorder(permRecorder)
 *     .build();
 *
 *   // After execution:
 *   permRecorder.getEvents();     // all permission events
 *   permRecorder.getBlocked();    // just blocked tools
 *   permRecorder.getDenied();     // execute-time rejections
 *   permRecorder.getSummary();    // { allowed: [...], blocked: [...], denied: [...] }
 */

import type { AgentRecorder, ToolCallEvent } from '../core/recorders';
import type { ToolContext } from '../core';

export interface PermissionEvent {
  readonly type: 'blocked' | 'denied' | 'allowed';
  readonly toolId: string;
  readonly phase: 'resolve' | 'execute';
  readonly timestamp: number;
}

export class PermissionRecorder implements AgentRecorder {
  readonly id = 'permission-recorder';
  private events: PermissionEvent[] = [];

  /**
   * Wire this to gatedTools({ onBlocked: recorder.onBlocked }).
   * Arrow function — safe to pass as callback directly.
   */
  readonly onBlocked = (
    toolId: string,
    phase: 'resolve' | 'execute',
    _context?: ToolContext,
  ): void => {
    this.events.push({
      type: phase === 'resolve' ? 'blocked' : 'denied',
      toolId,
      phase,
      timestamp: Date.now(),
    });
  };

  /** AgentRecorder hook — captures successful tool calls. */
  onToolCall(event: ToolCallEvent): void {
    if (!event.result.error) {
      this.events.push({
        type: 'allowed',
        toolId: event.toolName,
        phase: 'execute',
        timestamp: Date.now(),
      });
    }
  }

  /** All permission events in order. */
  getEvents(): readonly PermissionEvent[] {
    return this.events;
  }

  /** Tools blocked at resolve time (LLM never saw them). */
  getBlocked(): string[] {
    return [...new Set(this.events.filter((e) => e.type === 'blocked').map((e) => e.toolId))];
  }

  /** Tool calls denied at execute time (hallucinated/injected). */
  getDenied(): string[] {
    return [...new Set(this.events.filter((e) => e.type === 'denied').map((e) => e.toolId))];
  }

  /** Tools that were allowed and executed successfully. */
  getAllowed(): string[] {
    return [...new Set(this.events.filter((e) => e.type === 'allowed').map((e) => e.toolId))];
  }

  /** Summary for audit logging. */
  getSummary(): { allowed: string[]; blocked: string[]; denied: string[] } {
    return {
      allowed: this.getAllowed(),
      blocked: this.getBlocked(),
      denied: this.getDenied(),
    };
  }

  clear(): void {
    this.events = [];
  }
}
