import { AXIS_UNITS, durationMs } from '../duration.js';
import { instantOf, spellInstant, type InstantText } from '../instant.js';
import type { TimeRange } from '../range.js';
import type { WindowToConvert } from '../convert.js';

type Ms = { readonly ms: number; readonly offsetMinutes: number };

/** An instant a range bound names, exactly to the millisecond — `undefined` for a sub-millisecond one. */
function msOf(text: InstantText): Ms | undefined {
  const at = instantOf(text, 'strict');
  if (at === undefined || at.nanos !== 0) return undefined;
  return { ms: at.ms, offsetMinutes: at.offsetMinutes };
}

/** The range a form's bounds hold, for a window: a look-back's is `[now − L, now)`. */
function absoluteOf(window: WindowToConvert, now: InstantText): readonly [Ms, Ms] | undefined {
  if (window.lookback !== undefined) {
    const n = msOf(now);
    const length = durationMs(window.lookback, AXIS_UNITS);
    if (n === undefined || length === undefined) return undefined;
    return [
      { ms: n.ms - length, offsetMinutes: n.offsetMinutes },
      { ms: n.ms, offsetMinutes: n.offsetMinutes },
    ];
  }
  const from = msOf(window.range.from);
  const to = msOf(window.range.to);
  return from === undefined || to === undefined || from.ms >= to.ms ? undefined : [from, to];
}

function spanRange(fromMs: number, toMs: number): TimeRange | undefined {
  if (!(fromMs < toMs)) return undefined;
  const from = spellInstant({ ms: fromMs, nanos: 0 }, 0);
  const to = spellInstant({ ms: toMs, nanos: 0 }, 0);
  return from === undefined || to === undefined ? undefined : { from, to };
}

export { msOf, absoluteOf, spanRange };
export type { Ms };
