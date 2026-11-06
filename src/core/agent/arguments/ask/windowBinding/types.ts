/** Support: the existing window-binding and per-call fill result port. */
import type { CallWindow } from '../../../../../time/bind.js';
import type { TimeAnswerRow } from '../../../../../time/rows.js';
import type { TimeRange } from '../../../../../time/range.js';
import type { ZoneName } from '../../../../../time/zone.js';
import type { AskField, WindowFill } from '../types.js';

/** What an answer to a window field did: bound (the values per call), a follow-up question, or a misfit. */
export type WindowBinding =
  | {
      readonly fills: Readonly<Record<string, WindowFill>>;
      readonly refused?: Readonly<Record<string, string>>;
      /** Per filled call, the decision its `call-window` row records. */
      readonly filled: Readonly<Record<string, WindowFilled>>;
      /** The window the person settled: the range, its zone, and whether it was the offered reading. */
      readonly answered: {
        readonly range: TimeRange;
        readonly zone: ZoneName;
        readonly how: TimeAnswerRow['how'];
        readonly corrected?: TimeAnswerRow['corrected'];
      };
    }
  | { readonly followUp: AskField }
  | { readonly expected: string }
  /** The zone answer left readings none of which a member tool's facts allow: its calls are refused. */
  | { readonly outside: string };

/** One member call a bound window filled: its tool, and the fill decision its `call-window` row records. */
export interface WindowFilled {
  readonly toolName: string;
  readonly decision: Extract<CallWindow, { how: 'filled' }>;
}
