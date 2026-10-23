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
import { hostFillsOf } from '../../../tools/hostFilled.js';
import { searchOf } from '../../../tools/searchOf.js';
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
  /** What `dispatch` returned just before the call ran. */
  readonly dispatch?: SearchDispatch;
  /** The outcome the tool declared on its effects envelope, if any. */
  readonly status?: ToolResultStatus;
}

/** What the funnel takes just before a search tool's call runs. */
export interface SearchDispatch {
  /** The call's result identity, reserved before it runs — the row's address. */
  readonly resultId: string;
  /** The read's short handle — `r` and the reservation's ordinal. */
  readonly handle: string;
  /**
   * When the call was dispatched — the clock the time layer hands the tool
   * (`ctx.time.dispatchedAt`), or the moment itself. A relative window resolves
   * HERE: a call resumed hours after its pause ran with a later window than
   * the turn's start.
   */
  readonly dispatchedAt: string;
}

/** The funnel's two functions. */
export interface SearchCoverageFunnel {
  /**
   * Just BEFORE the call runs: reserve its result identity and take the
   * dispatch instant — only for a tool with an accepted `search`; `undefined`
   * (and no write) otherwise.
   */
  dispatch(
    scope: TypedScope<AgentState>,
    tool: Tool | undefined,
    callTime?: { readonly dispatchedAt?: string },
  ): SearchDispatch | undefined;
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

/** A run with no id of its own (a composition member with no link) still mints one. */
const UNIDENTIFIED_RUN = 'unidentified-run';

/**
 * Build the funnel over the run's id reader.
 *
 * @example
 * ```ts
 * const search = buildSearchCoverage((scope) => runFactsOf(scope)?.runId);
 * const dispatch = search.dispatch(scope, tool, ctx.time);
 * // … tool.execute …
 * const composed = search.compose(scope, { call, tool, args, dispatch }, result);
 * ```
 */
export function buildSearchCoverage(runIdOf: RunIdOf): SearchCoverageFunnel {
  const reserve = (scope: TypedScope<AgentState>): { resultId: string; handle: string } => {
    const runId = runIdOf(scope) || UNIDENTIFIED_RUN;
    const state = scope.resultIdentities ?? createVerificationState(runId);
    const reserved = reserveResultIdentity(state, runId);
    scope.resultIdentities = reserved.state;
    return { resultId: reserved.id, handle: `r${reserved.identity.ordinal}` };
  };
  return {
    dispatch(scope, tool, callTime) {
      if (tool === undefined || searchOf(tool).search === undefined) return undefined;
      return {
        ...reserve(scope),
        dispatchedAt: callTime?.dispatchedAt ?? new Date().toISOString(),
      };
    },
    compose(scope, boundary, value) {
      const { tool, call } = boundary;
      const { search, problem } = searchOf(tool);
      if (search === undefined) {
        if (readDeclaredAbsence(value) !== undefined || readDeclaredLedger(value) !== undefined) {
          throw refusal(
            problem !== undefined
              ? `checked: 'declared' says the tool declared its search, and tool ` +
                  `'${call.toolName}' carries a \`search\` this library refused — ${problem}`
              : `checked: 'declared' says the tool declared its search, and tool ` +
                  `'${call.toolName}' declares no \`search\` — add search: { source, subject, ` +
                  'arguments, … } to its defineTool, or write the checked list by hand.',
          );
        }
        return undefined;
      }
      const hostFilled = hostFillsOf(tool);
      // A boundary that took no dispatch (a door that predates it) still
      // addresses its row by a library-minted identity, at the moment it runs.
      const dispatched = boundary.dispatch ?? {
        ...reserve(scope),
        dispatchedAt: new Date().toISOString(),
      };
      const searchCall: SearchCall = {
        ...call,
        resultId: dispatched.resultId,
        handle: dispatched.handle,
        search,
        origin: isRemote(tool, boundary.party) ? 'remote' : 'local',
        args: boundary.args,
        ...(hostFilled !== undefined && { hostFilled }),
        ...(tool.period !== undefined && { period: tool.period }),
        dispatchedAt: dispatched.dispatchedAt,
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
