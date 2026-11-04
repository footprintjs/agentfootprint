import type { CheckInDecision } from '../../../../checkin.js';

/** Ephemeral values for one existing resume door; never checkpoint state. */
export interface ResumeCallFrame {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly startMs: number;
}

export interface ResumeConsentFrame extends ResumeCallFrame {
  readonly consentDecision: CheckInDecision;
  readonly runSignal: AbortSignal | undefined;
}

export interface ResumeResultFrame extends ResumeCallFrame {
  readonly input: unknown;
}
