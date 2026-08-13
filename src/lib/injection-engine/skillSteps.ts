/**
 * skillSteps — the procedure grammar (9.18.0). ONE owner of everything
 * "steps as data": the types, the validation, the step pointer's shape and
 * re-key rule, the `skip_step` integrity tool, and EVERY sentence the model
 * reads about a procedure (the banner, the result suffixes, the skip
 * sentences, the nudge). Stages and slots call in here; none of them owns
 * a word of the grammar.
 *
 * WHAT A PROCEDURE IS. `defineSkill({ steps })` declares an ordered list of
 * `{ tool, note }` pairs — "run these tools, in this order, for these
 * reasons". The framework then OWNS sequence and scope at the protocol
 * level: while a stepped skill holds the tenure, the tools slot offers only
 * the current step's tool (plus every escape hatch — see below), so the
 * model cannot call step 5's tool from step 3 because step 5's schema was
 * never sent. No refusal machinery, no new gate: an unoffered tool is
 * uncallable by construction.
 *
 * WHAT THE MODEL STILL OWNS: judgment inside the step. It can run the tool,
 * skip it with a recorded reason (`skip_step`), work around it with an
 * escape hatch, or stop and say why. The escape hatches are load-bearing
 * and stay offered under narrowing: `read_skill`, `list_skills`, every
 * OTHER active skill's tools, the baseline `.tool()` registry, provider
 * tools. A procedure is a declared order, not a cage.
 *
 * THE POINTER. `AgentState.stepPointer` records where the procedure stands:
 * `{ skillId, step, total, skipped }`, 1-based, `step === total + 1` means
 * complete. It is strictly SUBORDINATE to the one skill-graph cursor: it
 * lives and dies inside one skill's tenure, is re-keyed at the same stage
 * the cursor truth lives (Evaluate), and never crosses runs. It can never
 * move the cursor.
 *
 * CARRIER SHAPE (load-bearing): the pointer travels through scope and the
 * mount mappers as a 0-or-1-element ARRAY (`StepPointerCarrier`), never as
 * a bare object. footprintjs's `applyOutputMapping` shallow-merges bare
 * object values field-by-field — and APPENDS nested arrays — so a re-keyed
 * pointer mapped as an object would inherit the previous tenure's `skipped`
 * entries. A top-level array under `arrayMerge: Replace` is set wholesale.
 * `[]` = the feature is on and no procedure is active; the key is absent
 * entirely on agents with no stepped skill (zero-cost-when-unused).
 */

import { defineTool } from '../../core/tools.js';
import type { Tool } from '../../core/tools.js';
import type { Injection } from './types.js';

// ─── The declared shape ────────────────────────────────────────────────

/** One step of a declared procedure. */
export interface SkillStep {
  /** The tool this step runs. MUST be one of this skill's own `tools` —
   *  refused at `defineSkill` otherwise. Repeats across steps are legal
   *  ("look it up again after the change"). */
  readonly tool: string;
  /** Why/what — the sentence the model sees ("look up the order before
   *  touching money"). Required, non-empty: a step with no note is a
   *  force-march instruction, and the note is the whole point. */
  readonly note: string;
}

/**
 * What the framework does when the model skips a step with `skip_step`:
 *
 * - `'advance'` (default) — record the skip and move to the next step;
 * - `'hold'` — record the skip and keep the step current (its tool stays
 *   the offer; the model may retry it, work around it with the escape
 *   hatches, or finish and explain).
 */
export type OnSkipPolicy = 'advance' | 'hold';

/**
 * WHERE a declared procedure stands. 1-based; `step === total + 1` means
 * the procedure completed. `skipped` holds the indexes the model skipped
 * under the `'advance'` policy (a `'hold'` skip is recorded on the event
 * stream, not here — the pointer did not move).
 */
export interface StepPointer {
  /** The tenant this pointer belongs to — the stepped skill whose tenure
   *  is current. A cursor move away from it resets the pointer. */
  readonly skillId: string;
  /** Current step, 1-based. `total + 1` = procedure complete. */
  readonly step: number;
  readonly total: number;
  /** Step indexes skipped-with-reason that the pointer moved past. */
  readonly skipped: readonly number[];
}

/**
 * How the pointer travels through scope and every mount mapper: a
 * 0-or-1-element array. See the module docstring for why a bare object
 * cannot cross a footprintjs outputMapper safely.
 */
export type StepPointerCarrier = readonly StepPointer[];

/** The build-time fold of one stepped skill — frozen at `Agent` build. */
export interface StepPlan {
  readonly skillId: string;
  readonly steps: readonly SkillStep[];
  /** Every tool name the plan's steps name — the hold-out candidates. */
  readonly toolNames: ReadonlySet<string>;
  readonly onSkip: OnSkipPolicy;
}

/** The lookup the engine, the tools slot and the tool-calls stage share.
 *  Undefined ⇒ no skill on this agent declares steps (the zero-cost gate). */
export type StepPlanFor = (skillId: string) => StepPlan | undefined;

/** The integrity tool's reserved name. Auto-attached (dispatchable) when
 *  ≥1 registered skill declares steps; OFFERED only while a stepped tenure
 *  is active and unfinished. */
export const SKIP_STEP_TOOL_NAME = 'skip_step';

// ─── Validation (the defineSkill checkup — refuse at the earliest point) ──

/**
 * Validate a `steps` declaration against the skill's own tools. All the
 * data is in hand at `defineSkill`, so every refusal happens there — the
 * `body-unknown-tool` sibling.
 */
export function validateSkillSteps(
  skillId: string,
  opts: {
    readonly steps?: readonly SkillStep[];
    readonly onSkip?: OnSkipPolicy;
    readonly toolNames: ReadonlySet<string>;
  },
): void {
  const where = `defineSkill(${skillId})`;
  if (opts.steps === undefined) {
    if (opts.onSkip !== undefined) {
      throw new Error(
        `${where}: \`onSkip\` is legal only beside \`steps\` — it declares what a skipped ` +
          `step does, and this skill declares no steps. Add \`steps\` or drop \`onSkip\`.`,
      );
    }
    return;
  }
  if (opts.steps.length === 0) {
    throw new Error(
      `${where}: \`steps: []\` declares nothing — say what you mean and omit the field. ` +
        `A skill without steps is byte-identical to one that never heard of them.`,
    );
  }
  if (opts.onSkip !== undefined && opts.onSkip !== 'advance' && opts.onSkip !== 'hold') {
    throw new Error(
      `${where}: onSkip '${String(opts.onSkip)}' is not a policy this library has. The two ` +
        `are 'advance' (record the skip and move on — the default) and 'hold' (record the ` +
        `skip and keep the step current).`,
    );
  }
  if (opts.toolNames.size === 0) {
    throw new Error(
      `${where}: \`steps\` declares a tool sequence but this skill carries no \`tools\`. ` +
        `Every step runs one of the skill's own tools — add them to \`tools\`, or drop ` +
        `\`steps\`.`,
    );
  }
  opts.steps.forEach((step, i) => {
    const n = i + 1;
    if (!step || typeof step.tool !== 'string' || step.tool.trim().length === 0) {
      throw new Error(
        `${where}: step ${n} names no tool. Every step is { tool, note } — the tool is ` +
          `what the step runs.`,
      );
    }
    if (typeof step.note !== 'string' || step.note.trim().length === 0) {
      throw new Error(
        `${where}: step ${n} ('${step.tool}') has no note. The note is the sentence the ` +
          `model reads about WHY this step exists — a step without one is a force-march ` +
          `instruction, and the note is the whole point.`,
      );
    }
    if (!opts.toolNames.has(step.tool)) {
      throw new Error(
        `${where}: step ${n} names '${step.tool}', which this skill's \`tools\` does not ` +
          `carry — add the tool or fix the name. Steps may only sequence the skill's own ` +
          `tools; everything else stays available as an escape hatch, unsequenced.`,
      );
    }
  });
}

// ─── The build-time fold ──────────────────────────────────────────────

/** Read a skill injection's declared steps off its metadata bag (the
 *  `autoActivate` precedent — the engine ignores unknown keys). */
export function stepsOf(
  injection: Injection,
): { readonly steps: readonly SkillStep[]; readonly onSkip: OnSkipPolicy } | undefined {
  const meta = injection.metadata as
    | { steps?: readonly SkillStep[]; onSkip?: OnSkipPolicy }
    | undefined;
  if (!meta?.steps || meta.steps.length === 0) return undefined;
  return { steps: meta.steps, onSkip: meta.onSkip ?? 'advance' };
}

/**
 * Fold every stepped skill into one frozen plan map. Runs once at
 * `Agent` build; the map is threaded as closures — nothing rides
 * `projectActiveInjection`, so the projection allow-list is untouched.
 * Empty map ⇒ the feature is off everywhere (callers thread nothing).
 */
export function foldStepPlans(injections: readonly Injection[]): ReadonlyMap<string, StepPlan> {
  const plans = new Map<string, StepPlan>();
  for (const inj of injections) {
    if (inj.flavor !== 'skill') continue;
    const declared = stepsOf(inj);
    if (!declared) continue;
    plans.set(inj.id, {
      skillId: inj.id,
      steps: declared.steps.map((s) => ({ tool: s.tool, note: s.note })),
      toolNames: new Set(declared.steps.map((s) => s.tool)),
      onSkip: declared.onSkip,
    });
  }
  return plans;
}

// ─── Pointer helpers ──────────────────────────────────────────────────

/** Unwrap the carrier. `undefined` for an absent key, an empty carrier,
 *  or a value that is not a carrier at all. */
export function pointerOf(carrier: unknown): StepPointer | undefined {
  if (!Array.isArray(carrier) || carrier.length === 0) return undefined;
  const p = carrier[0] as StepPointer;
  return typeof p?.skillId === 'string' && typeof p?.step === 'number' ? p : undefined;
}

/** True while the procedure has steps left (`step <= total`). A completed
 *  pointer stays on scope as the record; nothing narrows or nudges on it. */
export function stepInProgress(ptr: StepPointer | undefined): ptr is StepPointer {
  return ptr !== undefined && ptr.step <= ptr.total;
}

/** The current step's declaration, when the procedure is in progress. */
export function currentStepOf(ptr: StepPointer, plan: StepPlan): SkillStep | undefined {
  return stepInProgress(ptr) ? plan.steps[ptr.step - 1] : undefined;
}

/**
 * The tenure RE-KEY — Evaluate's half of the pointer discipline.
 *
 * `tenant` is who holds the tenure THIS iteration: the advanced cursor on
 * graph agents, else the tail of `activatedInjectionIds` (the shipped
 * `activeSkillId` notion). Tenant changed → a fresh pointer when the new
 * tenant declares steps, else cleared. Tenant unchanged → pass-through.
 * Always returns a carrier (possibly empty) — the caller writes it every
 * iteration the feature is on, so downstream readers never see a stale one.
 */
export function rekeyStepPointer(args: {
  readonly prior: StepPointerCarrier | undefined;
  readonly tenant: string | undefined;
  readonly stepPlanFor: StepPlanFor;
}): StepPointerCarrier {
  const prior = pointerOf(args.prior);
  if (args.tenant === undefined) return [];
  if (prior?.skillId === args.tenant) return [prior];
  const plan = args.stepPlanFor(args.tenant);
  if (!plan) return [];
  return [{ skillId: args.tenant, step: 1, total: plan.steps.length, skipped: [] }];
}

// ─── The skip_step integrity tool ─────────────────────────────────────

/**
 * Build the `skip_step` tool. Auto-attached to the dispatch registry when
 * ≥1 registered skill declares steps (the `read_skill` auto-attach seam) —
 * always dispatchable, but OFFERED (schema in the request) only while a
 * stepped tenure is active and unfinished. Its execute returns a
 * placeholder; the tool-calls stage overwrites the model-visible result
 * with the authoritative sentence, exactly as the skill-graph gate
 * overwrites `read_skill` refusals — bookkeeping lives where the batch
 * order lives.
 */
export function buildSkipStepTool(): Tool {
  return defineTool<{ reason: string }, string>({
    name: SKIP_STEP_TOOL_NAME,
    description:
      'Skip the current step of the active skill procedure, with the reason on the record. ' +
      'Use it when the step cannot or should not run for this input.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why this step cannot or should not run. Goes on the record.',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    execute: () =>
      'skip_step noted. (Raw placeholder — the agent loop replaces this result with the ' +
      'authoritative step record; reading it verbatim means the runner that dispatched ' +
      'skip_step does not track step procedures.)',
  }) as unknown as Tool;
}

// ─── Every sentence the model reads ───────────────────────────────────

/** `[Step 3 of 6 — <note>] ` — prefixed onto the current step's tool
 *  description in the offer (a rebuilt schema copy, substituted by name). */
export function stepBannerPrefix(ptr: StepPointer, step: SkillStep): string {
  return `[Step ${ptr.step} of ${ptr.total} — ${step.note}] `;
}

/** The per-iteration `skip_step` offer description: names the current
 *  step, the remaining count, and the declared onSkip policy. */
export function skipStepDescription(ptr: StepPointer, plan: StepPlan): string {
  const step = plan.steps[ptr.step - 1]!;
  const remaining = ptr.total - ptr.step + 1;
  const policy =
    plan.onSkip === 'hold'
      ? 'the step stays current until it runs or the turn ends'
      : 'the procedure moves to the next step';
  return (
    `Skip step ${ptr.step} of ${ptr.total} ('${step.tool}' — ${step.note}) with a recorded ` +
    `reason. ${remaining} step(s) remain in the '${ptr.skillId}' procedure. On skip, ` +
    `${policy} (declared policy: '${plan.onSkip}').`
  );
}

/** Suffix for the `read_skill` result that activated a stepped skill:
 *  where the procedure starts. */
export function readSkillStepIntro(plan: StepPlan): string {
  const first = plan.steps[0]!;
  return (
    ` You are on step 1 of ${plan.steps.length}: ${first.note}. ` + `Its tool: \`${first.tool}\`.`
  );
}

/** Suffix for a completed step's tool result: done + what is next. */
export function stepAdvanceSuffix(next: StepPointer, plan: StepPlan): string {
  const done = next.step - 1;
  if (next.step > next.total) {
    return ` Step ${done} of ${next.total} done. All ${next.total} steps complete.`;
  }
  const coming = plan.steps[next.step - 1]!;
  return (
    ` Step ${done} of ${next.total} done. Now on step ${next.step} of ${next.total}: ` +
    `${coming.note} (tool: \`${coming.tool}\`).`
  );
}

/** The authoritative `skip_step` result under the `'advance'` policy. */
export function skipAdvanceSentence(
  skippedIndex: number,
  reason: string,
  next: StepPointer,
  plan: StepPlan,
): string {
  if (next.step > next.total) {
    return (
      `Step ${skippedIndex} skipped: ${reason}. That was the last step — the ` +
      `'${next.skillId}' procedure is complete (${next.skipped.length} step(s) skipped).`
    );
  }
  const coming = plan.steps[next.step - 1]!;
  return (
    `Step ${skippedIndex} skipped: ${reason}. Now on step ${next.step} of ${next.total}: ` +
    `${coming.note} (tool: \`${coming.tool}\`).`
  );
}

/** The authoritative `skip_step` result under the `'hold'` policy. */
export function skipHoldSentence(ptr: StepPointer, reason: string, plan: StepPlan): string {
  const step = plan.steps[ptr.step - 1]!;
  return (
    `Skip of step ${ptr.step} recorded: ${reason}. Step ${ptr.step} of ${ptr.total} stays ` +
    `current (declared policy 'hold') — run \`${step.tool}\`, or finish and say why.`
  );
}

/** Teaching result for `skip_step` with an empty reason — no event. */
export function skipNeedsReasonSentence(): string {
  return (
    'skip_step was not applied: `reason` is required and must be non-empty — it goes on ' +
    'the record. Say why this step cannot or should not run, then call skip_step again.'
  );
}

/** Teaching result for `skip_step` outside a stepped tenure — no event. */
export function skipNothingActiveSentence(): string {
  return (
    'skip_step has nothing to skip: no step procedure is active (or the active one is ' +
    'already complete). Continue with your other tools, or finish.'
  );
}

/** The remaining (unrun) steps — the `steps_unfinished` payload's list and
 *  the nudge's material. Under `'advance'` a skipped step is behind the
 *  pointer and therefore never "remaining". */
export function remainingStepsOf(
  ptr: StepPointer,
  plan: StepPlan,
): ReadonlyArray<{ readonly index: number; readonly tool: string; readonly note: string }> {
  if (!stepInProgress(ptr)) return [];
  return plan.steps
    .map((s, i) => ({ index: i + 1, tool: s.tool, note: s.note }))
    .filter((s) => s.index >= ptr.step);
}

/** The one teaching nudge for a premature stop (at most once per turn). */
export function nudgeTeachingMessage(ptr: StepPointer, plan: StepPlan): string {
  const remaining = remainingStepsOf(ptr, plan);
  const span =
    remaining.length === 1
      ? `Step ${remaining[0]!.index}`
      : `Steps ${remaining[0]!.index}–${remaining[remaining.length - 1]!.index}`;
  const list = remaining.map((s) => `${s.index}: ${s.note} (\`${s.tool}\`)`).join('; ');
  return (
    `${span} of '${ptr.skillId}' ${remaining.length === 1 ? 'has' : 'have'} not run — ` +
    `${list}. Finish them, or say why you are stopping.`
  );
}
