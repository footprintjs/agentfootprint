/**
 * toolChoice/compose — the tools slot's armed tail, behind the same `import()`.
 *
 * Pattern: one function the slot awaits under `.toolChoice()` — ask, decide,
 *          file the row, hand back what to commit.
 * Role:    core/ layer. Called ONLY by `slots/buildToolsSlot.ts ·
 *          composeStage` after `mergeWire`, through `import()` (the
 *          optional-family law of docs-next's site budget: everything this
 *          family adds to a model call lives off the default graph, and the
 *          slot keeps six lines). What it returns is committed by the slot's
 *          own `commitWire`, so the decoration, the receipt and the served
 *          view see the narrowed list at the one site they always read.
 */

import type { LLMToolSchema } from '../../../adapters/types.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';
import type { Classifier } from '../../../classify/types.js';
import { alwaysServedNames, narrowServed, pickTools } from './pick.js';
import { recordToolChoice, type ToolChoiceScope } from './record.js';
import type { ToolChoiceEntry, ToolChoiceRow } from './types.js';

export interface ComposeToolChoiceInput {
  readonly scope: ToolChoiceScope & { $getEnv(): { signal?: AbortSignal } };
  readonly classifier: Classifier;
  /** Serve the top-N plus the doors; absent = advisory only. */
  readonly top?: number;
  readonly alwaysServe?: readonly string[];
  readonly iteration: number;
  /** The merged wire, in order, and the slot record with the tool NAME behind each entry. */
  readonly merged: readonly LLMToolSchema[];
  readonly injections: readonly InjectionRecord[];
  readonly injectionNames: readonly string[];
  readonly userMessage: string;
  readonly currentSkillId?: string;
  /** The parent's rows — a frozen mount arg the slot never writes. */
  readonly prior: readonly ToolChoiceEntry[];
  readonly wrapUpAsked: boolean;
}

/** What the slot commits: the served list, its record, and the narrowed names when narrowed. */
export interface ComposedToolChoice {
  readonly served: readonly LLMToolSchema[];
  readonly servedInjections: readonly InjectionRecord[];
  readonly narrowedTo: ReadonlySet<string> | undefined;
}

/**
 * Ask the classifier about the merged wire minus the doors, decide what is
 * served, file the `pick` / `pick-error` row (the row records the offer the
 * classifier read and the list really served), and return the list to
 * commit. A call with nothing to choose among makes no classifier call and
 * files no row.
 */
export async function composeToolChoice(
  input: ComposeToolChoiceInput,
): Promise<ComposedToolChoice> {
  const { merged, injections, injectionNames, iteration, prior } = input;
  const doors = alwaysServedNames(input.alwaysServe);
  const offered = merged.filter((t) => !doors.has(t.name));
  if (offered.length === 0)
    return { served: merged, servedInjections: injections, narrowedTo: undefined };
  const pick = await pickTools(
    input.classifier,
    {
      userMessage: input.userMessage,
      ...(input.currentSkillId !== undefined && { currentSkillId: input.currentSkillId }),
      candidates: offered.map((t) => ({ name: t.name, description: t.description ?? '' })),
    },
    input.scope.$getEnv().signal,
  );
  const narrowing = narrowServed({
    wire: merged.map((t) => t.name),
    doors,
    pick,
    top: input.top,
    iteration,
    prior,
    wrapUpAsked: input.wrapUpAsked,
  });
  const servedNames = new Set(narrowing.served);
  const row: ToolChoiceEntry = pick.ok
    ? ({
        kind: 'pick',
        iteration,
        source: 'classifier',
        classifier: pick.classifier,
        offered: offered.map((t) => t.name),
        ranked: pick.ranked,
        ...(pick.chosen !== undefined && { chosen: pick.chosen }),
        confidence: pick.confidence,
        ...(pick.usage !== undefined && { usage: pick.usage }),
        latencyMs: pick.latencyMs,
        served: [...narrowing.served],
        narrowed: narrowing.narrowed,
        ...(narrowing.narrowedSkipped !== undefined && {
          narrowedSkipped: narrowing.narrowedSkipped,
        }),
      } satisfies ToolChoiceRow)
    : {
        kind: 'pick-error',
        iteration,
        source: 'classifier',
        classifier: pick.classifier,
        ...(pick.status !== undefined && { status: pick.status }),
        message: pick.message,
        latencyMs: pick.latencyMs,
        served: [...narrowing.served],
        ...(narrowing.narrowedSkipped !== undefined && {
          narrowedSkipped: narrowing.narrowedSkipped,
        }),
      };
  recordToolChoice(input.scope, row, prior);
  if (!narrowing.narrowed)
    return { served: merged, servedInjections: injections, narrowedTo: undefined };
  return {
    served: merged.filter((t) => servedNames.has(t.name)),
    // The slot record follows the served list: one InjectionRecord per tool
    // the model is handed, re-numbered so `position` is the served index.
    servedInjections: injections
      .filter((_, i) => servedNames.has(injectionNames[i] ?? ''))
      .map((r, i) => ({ ...r, position: i })),
    narrowedTo: servedNames,
  };
}
