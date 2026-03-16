/**
 * TurnRecorder — tracks turn-level lifecycle events.
 *
 * Records when turns start and complete, including message counts and
 * loop iterations. Useful for debugging multi-turn conversations and
 * understanding agent behavior over time.
 *
 * Usage:
 *   const turns = new TurnRecorder();
 *   agent.recorder(turns);
 *   await agent.run(...);
 *   console.log(turns.getTurns());
 */

import type { AgentRecorder, TurnStartEvent, TurnCompleteEvent, AgentErrorEvent } from '../../core';

export interface TurnEntry {
  readonly turnNumber: number;
  readonly message: string;
  readonly content?: string;
  readonly messageCount?: number;
  readonly totalLoopIterations?: number;
  readonly error?: unknown;
  readonly status: 'started' | 'completed' | 'error';
}

export class TurnRecorder implements AgentRecorder {
  readonly id: string;
  private turns: TurnEntry[] = [];

  constructor(id = 'turn-recorder') {
    this.id = id;
  }

  onTurnStart(event: TurnStartEvent): void {
    this.turns.push({
      turnNumber: event.turnNumber,
      message: event.message,
      status: 'started',
    });
  }

  onTurnComplete(event: TurnCompleteEvent): void {
    // Update the matching started entry, or add a new one
    const idx = this.turns.findIndex(
      (t) => t.turnNumber === event.turnNumber && t.status === 'started',
    );
    if (idx >= 0) {
      this.turns[idx] = {
        ...this.turns[idx],
        content: event.content,
        messageCount: event.messageCount,
        totalLoopIterations: event.totalLoopIterations,
        status: 'completed',
      };
    } else {
      this.turns.push({
        turnNumber: event.turnNumber,
        message: '',
        content: event.content,
        messageCount: event.messageCount,
        totalLoopIterations: event.totalLoopIterations,
        status: 'completed',
      });
    }
  }

  onError(event: AgentErrorEvent): void {
    const idx = this.turns.findIndex(
      (t) => t.turnNumber === event.turnNumber && t.status === 'started',
    );
    if (idx >= 0) {
      this.turns[idx] = {
        ...this.turns[idx],
        error: event.error,
        status: 'error',
      };
    } else {
      // Error fired before onTurnStart (e.g. prompt resolution failure).
      // Record it anyway — never silently drop errors.
      this.turns.push({
        turnNumber: event.turnNumber,
        message: '',
        error: event.error,
        status: 'error',
      });
    }
  }

  getTurns(): TurnEntry[] {
    return [...this.turns];
  }

  getCompletedCount(): number {
    return this.turns.filter((t) => t.status === 'completed').length;
  }

  getErrorCount(): number {
    return this.turns.filter((t) => t.status === 'error').length;
  }

  clear(): void {
    this.turns = [];
  }
}
