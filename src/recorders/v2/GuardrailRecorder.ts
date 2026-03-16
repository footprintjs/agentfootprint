/**
 * GuardrailRecorder — checks safety/policy constraints during execution.
 *
 * Calls a check function on each turn completion. If the check returns
 * a violation, it is recorded. Violations can be reviewed after execution
 * or used to trigger alerts.
 *
 * The check function receives the turn completion event and returns
 * either null (no violation) or a Violation object.
 *
 * Usage:
 *   const guardrail = new GuardrailRecorder(async (event) => {
 *     if (event.content.includes('CONFIDENTIAL')) {
 *       return { rule: 'pii-leak', message: 'Output contains confidential data' };
 *     }
 *     return null;
 *   });
 *   agent.recorder(guardrail);
 *   await agent.run(...);
 *   if (guardrail.hasViolations()) { ... }
 */

import type { AgentRecorder, TurnCompleteEvent } from '../../core';

// ── Types ────────────────────────────────────────────────────

export interface Violation {
  /** Rule or policy that was violated. */
  readonly rule: string;
  /** Human-readable description. */
  readonly message: string;
  /** Severity level. Defaults to 'warning'. */
  readonly severity?: 'info' | 'warning' | 'error';
  /** Which turn triggered the violation. */
  readonly turnNumber: number;
}

export type GuardrailCheck = (
  event: TurnCompleteEvent,
) => Violation | null | Promise<Violation | null>;

// ── Recorder ─────────────────────────────────────────────────

export class GuardrailRecorder implements AgentRecorder {
  readonly id: string;
  private readonly check: GuardrailCheck;
  private violations: Violation[] = [];

  constructor(check: GuardrailCheck, id = 'guardrail-recorder') {
    this.check = check;
    this.id = id;
  }

  onTurnComplete(event: TurnCompleteEvent): void {
    const result = this.check(event);
    if (result instanceof Promise) {
      result
        .then((v) => {
          if (v) this.violations.push(v);
        })
        .catch(() => {});
    } else if (result) {
      this.violations.push(result);
    }
  }

  getViolations(): Violation[] {
    return [...this.violations];
  }

  hasViolations(): boolean {
    return this.violations.length > 0;
  }

  getViolationsByRule(rule: string): Violation[] {
    return this.violations.filter((v) => v.rule === rule);
  }

  clear(): void {
    this.violations = [];
  }
}
