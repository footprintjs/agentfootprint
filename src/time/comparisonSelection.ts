import type { ClockRow, TimeAnswerRow } from './rows.js';
import { controlWindowOf, type TurnWindow, type TurnWindows } from './windows.js';

/**
 * The selected source's shared interval, or an empty selection until a person
 * settles it. An ordinary source has no comparison selection.
 */
export function comparisonForTool(
  clock: ClockRow | undefined,
  currentTurn: number,
  toolName: string,
  windows: TurnWindows,
  evidence?: {
    readonly boundWindow?: TurnWindow;
    readonly answers?: readonly TimeAnswerRow[];
  },
): { readonly window?: TurnWindow } | undefined {
  if (clock?.turn !== currentTurn || clock.comparison?.tools.includes(toolName) !== true)
    return undefined;

  const control = controlWindowOf(clock);
  if (control !== undefined) return { window: control };
  const bound = evidence?.boundWindow;
  if (bound?.source === 'answered') return { window: bound };

  const confirmation = evidence?.answers?.find(
    (answer) => answer.turn === currentTurn && answer.comparison === true,
  );
  if (confirmation !== undefined) {
    const { from, to, endpoint, zone, how } = confirmation;
    return {
      window: {
        source: 'answered',
        mention: confirmation.mention,
        range: { from, to },
        ...(endpoint !== undefined && { endpoint }),
        zone,
        answer: how,
      },
    };
  }
  const confirmed = windows.windows.filter((window) => window.source === 'answered');
  const window = confirmed.length === 1 ? confirmed[0] : undefined;
  return window === undefined ? {} : { window };
}
