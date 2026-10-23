/**
 * searchCoverage — the dispatch funnel's half of `Tool.search`: reserve the
 * call's result identity before it runs, compose its coverage after.
 *
 * Pattern: a deps-closure factory (the `toolResolver.ts` shape) so every
 *          execute boundary in `toolCalls.ts` — the batch loop and the resume
 *          doors — asks the same two functions.
 * Role:    core/agent. The rules live in `semantics/coverage/search/` (pure);
 *          this file reads the run's facts they need (the party, the
 *          host-filled set, the turn's clock, the reserved identity) and
 *          writes the one state key a reservation advances.
 * Emits:   N/A (the funnel's `declareCoverage` emits).
 *
 * Zero-cost when unused: a tool with no `search` reserves nothing, writes
 * nothing, and composes nothing — `prepare` and `compose` answer `undefined`
 * before reading anything else, so every other call takes today's path byte
 * for byte. The one exception is the literal `checked: 'declared'` from a tool
 * that declares no search: it is refused, naming the field to add, because the
 * literal claims a declaration that does not exist.
 */

import { isDevMode, type TypedScope } from 'footprintjs';

import { createVerificationState, reserveResultIdentity } from '../findings/verificationState.js';
import { readDeclaredAbsence, readDeclaredLedger } from '../../../semantics/coverage/recognize.js';
import { refusal } from '../../../semantics/coverage/refusal.js';
import {
  composeSearchCoverage,
  type SearchCall,
} from '../../../semantics/coverage/search/compose.js';
import type { CoverageReading } from '../../../semantics/coverage/read.js';
import type { ToolResultStatus } from '../../../semantics/toolOutcome.js';
import { clockOf } from '../../../time/rows.js';
import { hostFillsOf } from '../../../tools/hostFilled.js';
import type { Tool } from '../../../tools/tools.js';
import type { ToolParty } from '../../slots/buildToolsSlot.js';
import type { AgentState } from '../types.js';

/** The call's identity facts — the `declareCoverage` triple. */
interface CallFacts {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
}

/** What one boundary hands composition. */
export interface SearchBoundary {
  readonly call: CallFacts;
  readonly tool: Tool;
  /** The party that answered — `'provider'` makes the declaration remote. */
  readonly party?: ToolParty;
  /** The arguments the tool RAN with. */
  readonly args: Readonly<Record<string, unknown>>;
  /** The identity `reserve` returned before dispatch. */
  readonly resultId?: string;
  /** The outcome the tool declared on its effects envelope, if any. */
  readonly status?: ToolResultStatus;
}

/** The funnel's two functions. */
export interface SearchCoverageFunnel {
  /**
   * Reserve the call's result identity BEFORE it is dispatched — only for a
   * tool that declares its `search`; `undefined` (and no write) otherwise.
   */
  reserve(scope: TypedScope<AgentState>, tool: Tool | undefined): string | undefined;
  /**
   * Compose the call's coverage — `{ value, reading }` for the funnel to serve
   * and file, or `undefined` for today's path. THROWS a refusal for the
   * `'declared'` literal from a tool with no search (the call's error).
   */
  compose(
    scope: TypedScope<AgentState>,
    boundary: SearchBoundary,
    value: unknown,
  ): { readonly value: unknown; readonly reading: CoverageReading } | undefined;
}

/** The run's own id, for the identity — the typed events' `meta.runId`. */
export type RunIdOf = (scope: TypedScope<AgentState>) => string | undefined;

/** Tools already warned about a declined composition — once per tool per process. */
const warnedDeclined = new Set<string>();

function warnDeclined(toolName: string): void {
  if (warnedDeclined.has(toolName) || !isDevMode()) return;
  warnedDeclined.add(toolName);
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint search: tool '${toolName}' declares its \`search\` and returned a ` +
      'hand-written `checked` list beside it (checked-beside-declared). The result was read as ' +
      'written and nothing was composed, so its row establishes nothing — return checked: ' +
      "'declared' and let the declaration say what was searched. This warning fires once per " +
      'tool per process.',
  );
}

/** A declaration that arrived over MCP or from a ToolProvider is not first-party. */
const isRemote = (tool: Tool, party: ToolParty | undefined): boolean =>
  tool.source !== undefined || party?.channel === 'provider';

/** The TURN's clock: the time layer's frozen `now` when armed, else the turn's start. */
function turnNowOf(scope: TypedScope<AgentState>): string | undefined {
  const clock = clockOf(scope.findingsLedger as readonly unknown[] | undefined);
  if (clock !== undefined) return clock.now;
  const started = scope.turnStartMs as number | undefined;
  return typeof started === 'number' && Number.isFinite(started)
    ? new Date(started).toISOString()
    : undefined;
}

/** A run with no id of its own (a composition member with no link) still mints one. */
const UNIDENTIFIED_RUN = 'unidentified-run';

/**
 * Build the funnel over the run's id reader.
 *
 * @example
 * ```ts
 * const search = buildSearchCoverage((scope) => runFactsOf(scope)?.runId);
 * const resultId = search.reserve(scope, tool);
 * // … tool.execute …
 * const composed = search.compose(scope, { call, tool, args, resultId }, result);
 * ```
 */
export function buildSearchCoverage(runIdOf: RunIdOf): SearchCoverageFunnel {
  const reserve: SearchCoverageFunnel['reserve'] = (scope, tool) => {
    if (tool?.search === undefined) return undefined;
    const runId = runIdOf(scope) || UNIDENTIFIED_RUN;
    const state = scope.resultIdentities ?? createVerificationState(runId);
    const reserved = reserveResultIdentity(state, runId);
    scope.resultIdentities = reserved.state;
    return reserved.id;
  };
  return {
    reserve,
    compose(scope, boundary, value) {
      const { tool, call } = boundary;
      const search = tool.search;
      if (search === undefined) {
        if (readDeclaredAbsence(value) !== undefined || readDeclaredLedger(value) !== undefined) {
          throw refusal(
            `checked: 'declared' says the tool declared its search, and tool '${call.toolName}' ` +
              'declares no `search` — add search: { source, subject, arguments, … } to its ' +
              'defineTool, or write the checked list by hand.',
          );
        }
        return undefined;
      }
      const hostFilled = hostFillsOf(tool);
      const turnNow = turnNowOf(scope);
      const searchCall: SearchCall = {
        ...call,
        // A boundary that reserved nothing (a door that predates the
        // reservation) still addresses its row by a library-minted identity.
        resultId: boundary.resultId ?? (reserve(scope, tool) as string),
        search,
        origin: isRemote(tool, boundary.party) ? 'remote' : 'local',
        args: boundary.args,
        ...(hostFilled !== undefined && { hostFilled }),
        ...(tool.period !== undefined && { period: tool.period }),
        ...(turnNow !== undefined && { turnNow }),
        ...(boundary.status !== undefined && { status: boundary.status }),
      };
      const out = composeSearchCoverage(searchCall, value);
      if (out === undefined) return undefined;
      if (out.outcome === 'declined') {
        warnDeclined(call.toolName);
        return undefined;
      }
      return { value: out.value, reading: out.reading };
    },
  };
}
