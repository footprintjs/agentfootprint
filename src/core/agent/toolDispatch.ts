/**
 * toolDispatch — the run's own tool dispatch, delivered as `ctx.tools`.
 *
 * Pattern: a deps-closure factory beside `toolArtifacts` / `toolProgress` in
 *          the tool-calls handler; this module holds the PURE half (the
 *          dispatch object over a lookup + an inner-context maker) so the
 *          handler wires closures and nothing else.
 * Role:    core/agent — composition over the registry (the runbookAsTool
 *          substrate; any tool may consume it).
 * Emits:   nothing itself. Inner executes flow through the tool's own
 *          channels (`ctx.progress`, its result); they do NOT fire
 *          `tool_start`/`tool_end` — an inner call is the OUTER call's work,
 *          not a turn of the model's, and synthesizing model-facing events
 *          for it would put calls in the record the model never made.
 *
 * What an inner call is NOT (phase 1, refused loudly, never silently):
 *   - it cannot pause — a `checkIn` tool or a credential that needs
 *     interactive consent refuses by name;
 *   - it cannot redeem artifact refs — a `wants` tool refuses by name
 *     (dispatch-time resolution belongs to the model-facing loop);
 *   - it does not see ToolProvider-delivered tools — there is no build-time
 *     list of those (the 9.72.0 caveat, carried forward honestly);
 *   - it does not carry `ctx.tools` itself — composition depth stops at one,
 *     the same bound the runbook grammar declares for sub-runbooks.
 */

import type { Credential } from '../../identity/types.js';
import type {
  Tool,
  ToolDispatch,
  ToolDispatchCallOptions,
  ToolExecutionContext,
} from '../tools.js';

/** What the handler wires in — everything the dispatch cannot know itself. */
export interface AgentToolDispatchDeps {
  /** Name → Tool over the agent's dispatch map (static + skill-carried).
   *  Provider-delivered tools are invisible by construction. */
  readonly lookup: (name: string) => Tool | undefined;
  /**
   * Compose the execution context for ONE inner call: the outer call's own
   * facts with `hasArtifacts: false`, a derived `toolCallId` (`seq` makes it
   * unique within the outer call), and NO `tools` of its own.
   */
  readonly innerContext: (toolName: string, seq: number) => ToolExecutionContext;
}

/**
 * Build the `ctx.tools` dispatch for one outer tool call.
 *
 * `call` resolves the inner tool's declared `needs` through the inner
 * context's own credential provider (fail-closed — the provider throws its
 * teaching refusal when none is attached), refuses the shapes an inner call
 * cannot honor (see the module header), executes, and returns the result
 * exactly as the tool returned it. Policy about what a result MEANS — an
 * absence that should short-circuit, a coverage ledger that should fold —
 * belongs to the consumer wrapping this dispatch, never here.
 */
export function agentToolDispatch(deps: AgentToolDispatchDeps): ToolDispatch {
  let seq = 0;
  return {
    has(name: string): boolean {
      return deps.lookup(name) !== undefined;
    },
    async call(name: string, args: unknown, opts?: ToolDispatchCallOptions): Promise<unknown> {
      const tool = deps.lookup(name);
      if (tool === undefined) {
        throw new Error(
          `ctx.tools.call('${name}'): no tool of that name is in this agent's dispatch map ` +
            `(static .tool() registrations plus skill-carried tools). Tools delivered by a ` +
            `ToolProvider are not visible to inner dispatch — there is no build-time list of ` +
            `them. Register the tool statically, or check ctx.tools.has() first.`,
        );
      }
      if (tool.checkIn !== undefined) {
        throw new Error(
          `ctx.tools.call('${name}'): that tool declares a human check-in, and an inner ` +
            `dispatch call cannot pause — running it here would silently skip a consent ` +
            `gate somebody declared. Call it as a top-level tool, where the check-in rail ` +
            `holds.`,
        );
      }
      if (tool.wants !== undefined) {
        throw new Error(
          `ctx.tools.call('${name}'): that tool declares artifact arguments (wants), and ` +
            `inner dispatch does not resolve refs — the tool would run believing the ` +
            `framework delivered data it did not. Call it as a top-level tool, or pass the ` +
            `data through a tool that takes it directly.`,
        );
      }
      seq += 1;
      const base = deps.innerContext(name, seq);
      const ctx: ToolExecutionContext = {
        ...base,
        ...(opts?.signal !== undefined && { signal: opts.signal }),
        ...(tool.needs !== undefined && {
          credential: await resolveInnerCredential(name, tool, base),
        }),
      };
      return await tool.execute(args as Record<string, unknown>, ctx);
    },
  };
}

/**
 * Resolve a declared `needs` for an inner call — the simple, non-interactive
 * path only. Fail-closed: anything short of an issued credential refuses by
 * name, because the consent flow the outer loop would ride (pause, URL,
 * resume) has no seat inside a dispatch call.
 */
async function resolveInnerCredential(
  name: string,
  tool: Tool,
  ctx: ToolExecutionContext,
): Promise<Credential> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const need = tool.needs!;
  const result = await ctx.credentials.getCredential({
    service: need.credential,
    ...(need.scopes && { scopes: need.scopes }),
    ...(need.mode && { mode: need.mode }),
  });
  if (result.status === 'issued') return result.credential;
  throw new Error(
    `ctx.tools.call('${name}'): the tool's declared credential '${need.credential}' did not ` +
      `resolve to an issued credential (status '${result.status}'). An inner dispatch call ` +
      `cannot pause for consent — complete the authorization first, or call the tool at the ` +
      `top level where the consent rail can hold the run.`,
  );
}
