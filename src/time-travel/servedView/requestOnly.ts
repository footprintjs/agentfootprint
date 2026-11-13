import type { LLMMessage, LLMToolSchema } from '../../provider-contract/types.js';
import type { toolsWithheld } from '../../core/agent/composeRequest.js';
import { findingsContext } from '../../core/agent/findings/context.js';
import type { FindingsLedger } from '../../core/agent/findings/types.js';
import {
  findStagedRefs,
  issuedTicketsOf,
  stagedRefsNudgeLine,
} from '../../core/agent/stagedRefs.js';
import { evidenceConclusionLine } from '../../core/agent/evidence/recovery.js';
import { readAtCall as foldAtCall, type EpochLocation } from '../epochs.js';
import type { ServedRequestOnly } from '../servedView.js';
import { readAtCall, readRunConstant } from './recordReads.js';

/** `toolWantsByName` back as the map `findStagedRefs` takes. It is committed
 *  as a plain record because a `Map` does not survive the scope's write path
 *  (an object write is JSON-round-tripped, and a `Map` round-trips to `{}`). */
function wantsMapOf(value: unknown): ReadonlyMap<string, readonly string[]> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const map = new Map<string, readonly string[]>();
  for (const [name, kinds] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(kinds) && kinds.every((k) => typeof k === 'string')) {
      map.set(name, kinds as readonly string[]);
    }
  }
  return map.size > 0 ? map : undefined;
}

/** Rebuild request-only lines in wire order and retain late-layout uncertainty. */
export function requestOnlyAt(
  location: EpochLocation,
  served: boolean,
  asSent: readonly LLMMessage[],
  registered: readonly LLMToolSchema[],
  withheld: ReturnType<typeof toolsWithheld>,
  iteration: number,
  committed: readonly LLMMessage[],
  lateLayout: boolean,
  recordedBound: unknown,
  layoutUnknown: boolean,
): readonly [requestOnly: ServedRequestOnly[], layoutUnknown: boolean] {
  // ── the request-only lines ─────────────────────────────────────────────
  // The staged-refs nudge is a pure function of committed state: the
  // conversation, the tools really served this call, and the `wants`
  // declarations `seed` put on the record for exactly this reason.
  const requestOnly: ServedRequestOnly[] = [];
  const wants = wantsMapOf(readRunConstant(location, 'toolWantsByName', served));
  if (wants !== undefined) {
    // The issued tickets are committed state too (`placedTickets`), read at
    // this call exactly as `callLLM` read them live.
    const match = findStagedRefs(
      asSent,
      wants,
      new Set(registered.map((t) => t.name)),
      issuedTicketsOf(readAtCall(location, 'placedTickets', served)),
    );
    if (match !== undefined) {
      requestOnly.push({
        role: 'user',
        text: stagedRefsNudgeLine(match),
        reason: 'staged-refs-nudge',
      });
    }
  }
  // The time line (step T6b) — the tools slot's committed composition, served only on the
  // iteration that composed it and never on the wrap-up call (`callLLM` · the same three tests).
  const timeLine = readAtCall(location, 'timeLine', served) as
    | { readonly iteration?: unknown; readonly text?: unknown }
    | undefined;
  if (
    withheld === null &&
    typeof timeLine?.text === 'string' &&
    timeLine.text.length > 0 &&
    timeLine.iteration === readAtCall(location, 'iteration', served)
  ) {
    requestOnly.push({ role: 'user', text: timeLine.text, reason: 'time-window-line' });
  }
  // The evidence conclusion (the figures dial) — the committed carrier's late
  // line, on the iteration its instruction is served (`callLLM` · the same test).
  const conclusion = evidenceConclusionLine(
    readAtCall(location, 'evidenceRecovery', served) as Parameters<
      typeof evidenceConclusionLine
    >[0],
    readAtCall(location, 'evidenceRecoveryUsed', served) as boolean | undefined,
    iteration,
  );
  if (conclusion !== undefined) {
    requestOnly.push({ role: 'user', text: conclusion, reason: 'evidence-conclusion' });
  }

  if (lateLayout) {
    try {
      requestOnly.push({
        role: 'user',
        text: findingsContext(
          committed,
          foldAtCall(location, 'findingsLedger') as FindingsLedger | undefined,
          recordedBound as number,
        ),
        reason: 'findings-data',
      });
    } catch {
      layoutUnknown = true;
    }
  }
  return [requestOnly, layoutUnknown];
}
