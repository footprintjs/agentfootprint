/**
 * toolDispatch — the run's own tool dispatch, delivered as `ctx.tools`.
 *
 * Pattern: a deps-closure factory beside `toolArtifacts` / `toolProgress` in
 *          the tool-calls handler; this module holds the PURE half (the
 *          dispatch object over a lookup, an inner-context maker, the gates
 *          and a row writer) so the handler wires closures and nothing else.
 * Role:    core/agent — composition over the registry (the runbookAsTool
 *          substrate; any tool may consume it).
 * Emits:   nothing itself. Inner executes flow through the tool's own
 *          channels (`ctx.progress`, its result); they do NOT fire
 *          `tool_start`/`tool_end` — an inner call is the OUTER call's work,
 *          not a turn of the model's, and synthesizing model-facing events
 *          for it would put calls in the record the model never made. The
 *          gates file their own events under the inner call's id, and each
 *          call leaves one row through `deps.record` (`innerToolCalls.ts`).
 *
 * What an inner call PASSES (the model's own gates, by the same functions, in
 * the model call's order — `stages/toolCalls/execution/dispatchCall.ts`):
 *   1. the permission checker, about `tool_call` and every capability the
 *      tool declares that the checker governs, handed the run's `sequence`
 *      plus the inner calls of the same outer call that already ran
 *      (`stages/toolCalls/access/innerCallGates.ts`);
 *   2. the tool's argument rules (`refuseUnaccountedRuledArguments`, below);
 *   3. the before-tool middleware chain — a link's rewrite is what the tool
 *      runs with, as on a model call;
 *   4. the name (a name the dispatch map does not hold), then the input
 *      schema, then — for `read_skill` — the checker's `skill_read`
 *      question (`access/skillReadQuestion.ts`), then the shapes an inner
 *      call cannot honour (below), then a declared credential.
 * All under the inner call's own id (`<outer>#inner-<n>`) and with its own
 * arguments: ONE detached copy taken before the first await
 * (`innerCallArguments.ts`), so what the gates judged is what runs. What a
 * gate refuses for a model call it refuses here: the inner call is refused by
 * name and the tool's function is not entered. A checker's `'halt'` refuses
 * the inner call and ends the run after the outer call settles
 * (`innerCallOuter.ts`).
 *
 * What an inner call is NOT (refused loudly, never silently):
 *   - it cannot pause — a `checkIn` tool, a middleware `ask` or a credential
 *     that needs interactive consent refuses by name (a pause the inner tool
 *     itself RAISES, `requestInput` or `pauseHere`, is not refused: it
 *     passes up as the OUTER call's pause, and an `absence` it declares is
 *     filed under the outer call — `semantics/coverage/README.md` § 4);
 *   - it cannot redeem artifact refs — a `wants` tool refuses by name
 *     (dispatch-time resolution belongs to the model-facing loop);
 *   - it does not see ToolProvider-delivered tools — there is no build-time
 *     list of those (the 9.72.0 caveat, carried forward honestly);
 *   - it does not carry `ctx.tools` itself — composition depth stops at one,
 *     the same bound the runbook grammar declares for sub-runbooks;
 *   - it is not made after its outer call ended — a `ctx.tools` kept past
 *     the outer `execute` refuses every later call by name;
 *   - its result meets no after-tool link — those see the OUTER call's
 *     result, which is what the model reads; no after-tool row is filed
 *     for an inner call, so no chain is recorded as having allowed it;
 *   - it does not apply argument rules — a tool that declares `askOrAssume`
 *     refuses an inner call that leaves a ruled argument out (the inputs
 *     layer fills and records only the model's own calls). A declared
 *     `period`'s forms are ALTERNATIVES: the window is owed once, and a call
 *     that gives one form whole (a look-back, or both bounds) is not refused
 *     for the other forms' arguments.
 */

import type { Credential } from '../../identity/types.js';
import { formatToolArgIssues, validateToolArgs } from '../../tools/toolArgsValidation.js';
import {
  isMissing,
  isRefused,
  periodFormsOf,
  rulesOf,
  sentFormOf,
  untakenBesides,
} from '../../tools/declare.js';
import { formArguments, type PeriodForm } from '../../time/periodForm.js';
import type { ToolArgs } from '../../tools/runChain.js';
import type {
  Tool,
  ToolDispatch,
  ToolDispatchCallOptions,
  ToolExecutionContext,
} from '../../tools/tools.js';
import { isPauseRequest } from '../pause.js';
import { notCopyableRefusal, notObjectRefusal, takeArguments } from './innerCallArguments.js';
import type { OuterCallBinding } from './innerCallOuter.js';

/** The one spelling of an inner call's id: the outer call's id, `#inner-`, its number. */
export function innerToolCallId(outerToolCallId: string, seq: number): string {
  return `${outerToolCallId}#inner-${seq}`;
}

/** The number an inner id ends in — the order its composing tool made the call. */
export function innerCallNumberOf(toolCallId: string): number {
  return Number(toolCallId.slice(toolCallId.lastIndexOf('#inner-') + '#inner-'.length));
}

/** One inner call as a gate is asked about it — its own id, tool and arguments. */
export interface InnerCallAsked {
  readonly toolCallId: string;
  readonly toolName: string;
  /** The tool the name resolved to — absent for a name the map does not hold, as on a model call. */
  readonly tool?: Tool;
  readonly args: ToolArgs;
  readonly signal?: AbortSignal;
}

/**
 * A gate's answer: run (with `args` only when the gate rewrote them), or refuse
 * with the gate's own words — `halted` when the refusal is a checker's halt.
 */
export type InnerGateAnswer =
  | { readonly kind: 'allow'; readonly args?: ToolArgs }
  | { readonly kind: 'refuse'; readonly reason: string; readonly halted?: true };

/** The gates an inner call passes. A gate the agent did not configure is absent. */
export interface InnerCallGates {
  /** The checker's `tool_call` question and its declared-capability questions. */
  readonly permission?: (call: InnerCallAsked) => Promise<InnerGateAnswer>;
  /** The before-tool middleware chain. */
  readonly middleware?: (call: InnerCallAsked) => Promise<InnerGateAnswer>;
  /** The checker's `skill_read` question, for an inner `read_skill`. */
  readonly skillRead?: (call: InnerCallAsked) => Promise<InnerGateAnswer>;
}

/** How an inner call ended: `'returned'`, `'threw'` and `'paused'` only after its function was entered. */
export type InnerCallEnd = 'returned' | 'threw' | 'paused' | 'refused';

/**
 * Who refused an inner call: a gate; inner dispatch's own refusals (an
 * unknown name, a check-in, arguments that are not an object, …); or
 * `'ended'` — the call was made through a `ctx.tools` its outer call had
 * already left.
 */
export type InnerCallRefuser = 'permission' | 'middleware' | 'dispatch' | 'ended';

/** The facts of one finished inner call, handed to `deps.record`. */
export interface InnerCallFacts {
  readonly toolCallId: string;
  readonly toolName: string;
  /** The tool the name resolved to — absent for a name the map does not hold. */
  readonly tool?: Tool;
  /**
   * The arguments as they stood when the call ended: the detached copy, after
   * every rewrite a gate allowed. `{}` when the composing tool passed nothing
   * (the call runs with `{}`) or something that is not an object (the call was
   * refused, and that value is not kept).
   */
  readonly args: ToolArgs;
  readonly entered: boolean;
  readonly ended: InnerCallEnd;
  readonly refusedBy?: InnerCallRefuser;
  /** The refusal was a checker's `'halt'`: the run ends after the outer call settles. */
  readonly halted?: true;
}

/** What the handler wires in — everything the dispatch cannot know itself. */
export interface AgentToolDispatchDeps {
  /** The model's call whose tool holds this dispatch — every inner id derives from it. */
  readonly outerToolCallId: string;
  /** Name → Tool over the agent's dispatch map (static + skill-carried).
   *  Provider-delivered tools are invisible by construction. */
  readonly lookup: (name: string) => Tool | undefined;
  /**
   * Compose the execution context for ONE inner call: the outer call's own
   * facts with `hasArtifacts: false`, the inner call's `toolCallId`, and NO
   * `tools` of its own.
   */
  readonly innerContext: (toolName: string, toolCallId: string) => ToolExecutionContext;
  /** The model call's gates, put to each inner call (`innerCallGates.ts`). */
  readonly gates?: InnerCallGates;
  /** Keep one row for each inner call, when it ends (`innerToolCalls.ts`). */
  readonly record?: (facts: InnerCallFacts) => void;
  /** The outer call's hold (`innerCallOuter.ts`): a call made after it ended is refused. */
  readonly outer?: Pick<OuterCallBinding, 'ended'>;
}

const GATE_NAMES: Readonly<Record<keyof InnerCallGates, string>> = {
  permission: 'the permission check',
  middleware: 'the tool middleware',
  skillRead: 'the permission check',
};

/** Who a gate's refusal is filed under: the skill-read question is the permission check's. */
const REFUSERS: Readonly<Record<keyof InnerCallGates, InnerCallRefuser>> = {
  permission: 'permission',
  middleware: 'middleware',
  skillRead: 'permission',
};

/** A refusal by a gate, carried to the call's row. */
class GateRefusal extends Error {
  constructor(message: string, readonly refusedBy: InnerCallRefuser, readonly halted: boolean) {
    super(message);
  }
}

/**
 * Build the `ctx.tools` dispatch for one outer tool call.
 *
 * `call` takes the inner call's id and its one copy of the arguments first
 * (synchronously, so concurrent calls are numbered in the order they were made
 * and a composing tool's later writes reach nothing), then puts the call
 * through the model call's gates and refusals in the model call's order (see
 * the module header), resolves a declared `needs` through the inner context's
 * own credential provider (fail-closed — the provider throws its teaching
 * refusal when none is attached), executes, and returns the result exactly as
 * the tool returned it. Every call — refused, thrown or returned — ends in one
 * `deps.record`. Policy about what a result MEANS — an absence that should
 * short-circuit, a coverage ledger that should fold — belongs to the consumer
 * wrapping this dispatch, never here.
 */
export function agentToolDispatch(deps: AgentToolDispatchDeps): ToolDispatch {
  let seq = 0;
  return {
    has(name: string): boolean {
      return deps.lookup(name) !== undefined;
    },
    async call(name: string, args: unknown, opts?: ToolDispatchCallOptions): Promise<unknown> {
      seq += 1;
      const toolCallId = innerToolCallId(deps.outerToolCallId, seq);
      const tool = deps.lookup(name);
      // Before the first await: the copy every gate, refusal and the tool get.
      const taken = takeArguments(args);
      let ran: ToolArgs = taken.kind === 'copied' ? taken.args : {};
      let entered = false;
      let refusedBy: InnerCallRefuser = 'dispatch';
      let halted = false;
      const end = (ended: InnerCallEnd): void =>
        keepRow(deps, {
          toolCallId,
          toolName: name,
          ...(tool !== undefined && { tool }),
          args: ran,
          entered,
          ended,
          ...(ended === 'refused' && { refusedBy }),
          ...(ended === 'refused' && halted && { halted: true as const }),
        });
      const pass = async (gate: keyof InnerCallGates): Promise<void> => {
        const ask = deps.gates?.[gate];
        if (ask === undefined) return;
        const answer = await askGate(ask, {
          toolCallId,
          toolName: name,
          ...(tool !== undefined && { tool }),
          args: ran,
          ...(opts?.signal !== undefined && { signal: opts.signal }),
        });
        if (answer.kind === 'allow') {
          // Only a rewrite replaces what runs; an allow hands nothing back.
          if (answer.args !== undefined) ran = answer.args;
          return;
        }
        throw new GateRefusal(
          `ctx.tools.call('${name}'): ${GATE_NAMES[gate]} refused this inner call, so the ` +
            `tool did not run: ${answer.reason}`,
          REFUSERS[gate],
          answer.halted === true,
        );
      };
      try {
        if (deps.outer?.ended === true) {
          refusedBy = 'ended';
          throw new Error(endedRefusal(name, deps.outerToolCallId));
        }
        if (taken.kind === 'not-object') {
          throw new Error(
            tool === undefined
              ? unknownNameRefusal(name)
              : notObjectRefusal(name, args, tool.schema.inputSchema),
          );
        }
        if (taken.kind === 'not-copyable') throw new Error(notCopyableRefusal(name));
        await pass('permission');
        if (tool !== undefined) refuseUnaccountedRuledArguments(name, tool, ran);
        await pass('middleware');
        if (tool === undefined) throw new Error(unknownNameRefusal(name));
        const validation = validateToolArgs(ran, tool.schema.inputSchema);
        if (!validation.ok) throw new Error(formatToolArgIssues(name, validation.issues));
        await pass('skillRead');
        refuseWhatAnInnerCallCannotHonor(name, tool);
        const base = deps.innerContext(name, toolCallId);
        const ctx: ToolExecutionContext = {
          ...base,
          ...(opts?.signal !== undefined && { signal: opts.signal }),
          ...(tool.needs !== undefined && {
            credential: await resolveInnerCredential(name, tool, base),
          }),
        };
        entered = true;
        const result = await tool.execute(ran, ctx);
        end('returned');
        return result;
      } catch (err) {
        if (err instanceof GateRefusal) {
          refusedBy = err.refusedBy;
          halted = err.halted;
        }
        end(!entered ? 'refused' : isPauseRequest(err) ? 'paused' : 'threw');
        throw err;
      }
    },
  };
}

/**
 * Ask one gate. A gate that throws refuses: something that did not answer did
 * not say yes (the model call's law, `toolPermission.ts`). Its message is an
 * operator's fact and stays off the refusal the composing tool reads. (The
 * gates catch a checker's or a link's throw themselves; this is what is left —
 * the walker itself failing on an answer it cannot read.)
 */
async function askGate(
  ask: (call: InnerCallAsked) => Promise<InnerGateAnswer>,
  call: InnerCallAsked,
): Promise<InnerGateAnswer> {
  try {
    return await ask(call);
  } catch {
    return { kind: 'refuse', reason: GATE_GAVE_NO_ANSWER };
  }
}

/** The reason a gate that threw out of itself refuses with. */
export const GATE_GAVE_NO_ANSWER = 'the gate gave no answer, and no answer is not an allow.';

/**
 * Keep the call's row. A row that cannot be kept — the composing tool did not
 * await its inner call, and the stage it ran in has already committed — must
 * not turn what the call did into something else, so it is dropped here.
 */
function keepRow(deps: AgentToolDispatchDeps, facts: InnerCallFacts): void {
  try {
    deps.record?.(facts);
  } catch {
    // The stage that held the record has ended: nothing is left to write to.
  }
}

/** The refusal for a name the dispatch map does not hold. */
function unknownNameRefusal(name: string): string {
  return (
    `ctx.tools.call('${name}'): no tool of that name is in this agent's dispatch map ` +
    `(static .tool() registrations plus skill-carried tools). Tools delivered by a ` +
    `ToolProvider are not visible to inner dispatch — there is no build-time list of ` +
    `them. Register the tool statically, or check ctx.tools.has() first.`
  );
}

/** The refusal for a call made through a `ctx.tools` whose outer call has ended. */
function endedRefusal(name: string, outerToolCallId: string): string {
  return (
    `ctx.tools.call('${name}'): this ctx.tools belonged to tool call '${outerToolCallId}', ` +
    `which has ended — an inner call is part of its outer call's work, and a call made ` +
    `after it would be judged and filed as a call that is over. The tool did not run. Make ` +
    `inner calls inside execute, and await them before it returns.`
  );
}

/** The shapes an inner call cannot honour — after the schema and the skill-read question, as on a model call. */
function refuseWhatAnInnerCallCannotHonor(name: string, tool: Tool): void {
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
}

/**
 * An inner call to a tool that declares argument rules (honesty layer 2) must
 * give every ruled argument itself: inner dispatch fills nothing and files no
 * row — the values are the composing tool's code, and the OUTER call is the
 * accounted unit — so running a ruled tool with a ruled value missing would
 * run it on a value nobody chose, with nothing on the record. Refused by name,
 * like a `checkIn` or `wants` tool here. A rule that cannot be read refuses
 * too; a tool that declares nothing is never asked.
 *
 * A window is owed ONCE: a period's forms are alternatives, so the form the
 * call sent its window in (`declare.ts` · `sentFormOf`) is the window and the
 * other forms' arguments are not owed; a period with several forms left out,
 * or given in part, is named once, as its forms. One form keeps the
 * per-argument sentence it always had.
 */
function refuseUnaccountedRuledArguments(name: string, tool: Tool, given: ToolArgs): void {
  const rules = rulesOf(tool);
  if (rules === undefined) return;
  if (isRefused(rules)) {
    throw new Error(
      `ctx.tools.call('${name}'): that tool's argument rules could not be read ` +
        `(${rules.refused}) — inner dispatch refuses it rather than run it unruled.`,
    );
  }
  const forms = periodFormsOf(rules.period);
  const several = forms.length > 1;
  const sent = several ? sentFormOf(forms, given) : undefined;
  const untaken = sent !== undefined ? untakenBesides(forms, sent) : new Set<string>();
  const missing = rules.ruled
    .filter((r) => !untaken.has(r.argument) && isMissing(given, r.argument))
    .map((r) => r.argument);
  if (missing.length === 0) return;
  const window = several ? windowArgumentNames(forms) : new Set<string>();
  const named = missing.filter((m) => !window.has(m)).map((m) => `'${m}'`);
  if (missing.some((m) => window.has(m))) named.push(`one window — ${formsSpelled(forms)} —`);
  throw new Error(
    `ctx.tools.call('${name}'): that tool declares argument rules (askOrAssume) and the call ` +
      `leaves ${named.join(', ')} out — inner dispatch fills nothing and ` +
      `files no row, so running it would run on a value nobody chose, off the record. Pass ` +
      `every ruled argument, or call the tool as a top-level tool, where the inputs layer ` +
      `applies its rules.`,
  );
}

/** Every form's window arguments (the zone aside — a zone is owed as itself). */
function windowArgumentNames(forms: readonly PeriodForm[]): ReadonlySet<string> {
  return new Set(
    forms.flatMap((f) =>
      formArguments(f)
        .filter((a) => a.role !== 'zone')
        .map((a) => a.argument),
    ),
  );
}

/** The forms, spelled for a sentence: `'window', or 'start' and 'stop'`. */
function formsSpelled(forms: readonly PeriodForm[]): string {
  return forms
    .map((f) =>
      formArguments(f)
        .filter((a) => a.role !== 'zone')
        .map((a) => `'${a.argument}'`)
        .join(' and '),
    )
    .join(', or ');
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
