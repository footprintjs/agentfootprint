/**
 * core/time/wire — the time layer's JSON that crosses a transport (time
 * design § 7.5): `ctx.time`, the window a call asks for, handed to the tool.
 *
 * Pattern: one versioned shape, the same object in process and on the wire.
 *          In process it is `ToolExecutionContext.time`; over MCP it travels
 *          in the `tools/call` request's `_meta.agentfootprint.time`
 *          (`lib/mcp/mcpClient.ts` sends it, `lib/mcp/mcpServe.ts` hands it
 *          to the served tool); a transport with no metadata slot sends
 *          nothing, and the tool declares its period from its own arguments.
 *          A tool's `period` declaration itself travels in the listing's
 *          `_meta.agentfootprint.period`, judged by `arguments/declare.ts`.
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `range.ts` and
 *          `zone.ts` only.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * timeContextOf({ asked: { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' } },
 *   { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' }, '2026-10-09T15:40:02.114Z');
 * // { version: 1, asked: { from: …, to: …, edge: 'exclusive' }, zone: 'America/Los_Angeles',
 * //   now: '2026-10-09T15:40:00Z', dispatchedAt: '2026-10-09T15:40:02.114Z' }
 * ```
 */

import { instantOf, type InstantText } from './instant.js';
import { isTimeRange, type TimeRange } from './range.js';
import { isZoneName, type ZoneName } from './zone.js';

/** The shape's version — a reader refuses one it does not know. */
export const TIME_CONTEXT_VERSION = 1;

/** The `_meta.agentfootprint` key the call's time travels under over MCP. */
export const TIME_CONTEXT_META_KEY = 'time';

/**
 * What a tool that declares a period is handed about the call's time
 * (`ctx.time`). `asked` is the half-open range the call asks for — the
 * person's window when the library filled or bound it, the sent value read
 * back otherwise — so a tool can declare the `period.queried` its read covered
 * without parsing its own argument. Absent when no form read the call back.
 */
export interface TimeContext {
  readonly version: typeof TIME_CONTEXT_VERSION;
  readonly asked?: TimeRange & { readonly edge: 'exclusive' };
  /** The person's zone for this run (the clock's). */
  readonly zone: ZoneName;
  /** The turn's frozen clock (§ 4). */
  readonly now: InstantText;
  /** The wall clock when the library handed the call to the tool — the `call` row's. */
  readonly dispatchedAt: InstantText;
}

/** The context for one call, from its `call-window` row's `asked`, the turn's clock and the dispatch moment. */
export function timeContextOf(
  window: { readonly asked?: TimeRange } | undefined,
  clock: { readonly now: InstantText; readonly zone: ZoneName },
  dispatchedAt: InstantText,
): TimeContext {
  const asked = window?.asked;
  return {
    version: TIME_CONTEXT_VERSION,
    ...(asked !== undefined && {
      asked: { from: asked.from, to: asked.to, edge: 'exclusive' as const },
    }),
    zone: clock.zone,
    now: clock.now,
    dispatchedAt,
  };
}

/**
 * A received context read — the version this runtime knows, every field well
 * formed — or `undefined`. What a served tool is handed from the wire; never
 * repaired.
 */
export function readTimeContext(value: unknown): TimeContext | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (!keys.every((k) => ['version', 'asked', 'zone', 'now', 'dispatchedAt'].includes(k))) {
    return undefined;
  }
  if (v.version !== TIME_CONTEXT_VERSION || !isZoneName(v.zone)) return undefined;
  if (
    instantOf(v.now, 'strict') === undefined ||
    instantOf(v.dispatchedAt, 'strict') === undefined
  ) {
    return undefined;
  }
  let asked: TimeContext['asked'];
  if (v.asked !== undefined) {
    if (v.asked === null || typeof v.asked !== 'object' || Array.isArray(v.asked)) return undefined;
    const { edge, ...range } = v.asked as Record<string, unknown>;
    if (edge !== 'exclusive' || !isTimeRange(range)) return undefined;
    asked = { from: range.from, to: range.to, edge };
  }
  return {
    version: TIME_CONTEXT_VERSION,
    ...(asked !== undefined && { asked }),
    zone: v.zone,
    now: v.now as InstantText,
    dispatchedAt: v.dispatchedAt as InstantText,
  };
}
