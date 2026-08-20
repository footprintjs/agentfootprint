/**
 * promptTemplate — an instruction that can SAY a run-time fact, from a closed
 * vocabulary the library owns.
 *
 * Pattern: Pure functions over a string (no scope, no I/O, no clock).
 * Role:    lib/ layer. Used at DEFINE time to refuse a template naming
 *          something that does not exist, and at EVALUATE time to render one
 *          — the single moment the context and the content are both in scope
 *          (`projectActiveInjection`).
 * Emits:   N/A.
 *
 * ## Why a closed vocabulary and not a function
 *
 * `Injection.inject` is static data, so an instruction could be GATED on the
 * iteration and could never SAY it: `activeWhen: (ctx) => ctx.iteration > 22`
 * is expressible, "you have used 23 of your 30 actions" is not. The framework
 * hit this three times itself — `defineStepsHint`, `defineMenuHint` and
 * `defineRelevanceHint` each carry a STATIC body and push their DATA through a
 * tool description, because `inject` cannot render. That workaround only works
 * for content the framework can attach to a tool it owns, which is exactly
 * what a consumer reported: they had to ride the count on their own tool
 * results.
 *
 * The obvious fix — let `inject` be `(ctx) => InjectionContent` — fails on
 * ABSENCE. Given a function, an author writes `${ctx.maxIterations}` and ships
 * *"23 of undefined"*, or writes `?? 0` and ships a fabricated denominator the
 * library cannot tell from a real zero. With named slots the LIBRARY owns
 * absence and applies one rule: if any fact a template names is unavailable,
 * the whole instruction is skipped, by name, on the record. Never a fake zero,
 * never a gap, never the literal placeholder.
 *
 * ## The vocabulary
 *
 * Three words, all about the turn's action budget, because that is the fact
 * the field report measured:
 *
 *   `{{action}}`            the action about to be taken (1-based)
 *   `{{actionBudget}}`      how many the turn is allowed
 *   `{{actionsRemaining}}`  how many are left, never negative
 *
 * It is closed on purpose. A name this file does not know is refused at define
 * time, when a person is looking at the error — not at iteration 23 of a paid
 * run.
 */

import type { InjectionContext } from './types.js';
import { iterationsRemainingOf } from '../iterationBudget.js';

/** Every fact a `promptTemplate` may name. Closed. */
export const TEMPLATE_FACTS = ['action', 'actionBudget', 'actionsRemaining'] as const;

export type TemplateFact = (typeof TEMPLATE_FACTS)[number];

/**
 * What a placeholder looks like. Whitespace inside the braces is tolerated so
 * `{{ action }}` and `{{action}}` are the same thing; anything else is not a
 * placeholder at all and is left exactly as written.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Every name the template asks for, in order of appearance, deduplicated. */
export function placeholdersIn(template: string): readonly string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** True when this string asks for anything at all. */
export function isTemplate(template: string): boolean {
  return placeholdersIn(template).length > 0;
}

/**
 * Refuse a template naming something this library cannot supply — at define
 * time, by name, listing what it CAN supply.
 *
 * @param label the factory + id, so the error names the door the author used
 */
export function assertKnownFacts(template: string, label: string): void {
  const unknown = placeholdersIn(template).filter(
    (name) => !(TEMPLATE_FACTS as readonly string[]).includes(name),
  );
  if (unknown.length === 0) return;
  throw new Error(
    `${label}: promptTemplate names ${unknown.map((u) => `{{${u}}}`).join(', ')}, which this ` +
      `library does not supply. The vocabulary is closed and has three words: ` +
      `${TEMPLATE_FACTS.map((f) => `{{${f}}}`).join(', ')}. It is closed so that a name ` +
      `nobody can fill is refused here, where you are looking, rather than rendering as a ` +
      `literal in front of the model on iteration 23 of a paid run.`,
  );
}

/**
 * The facts a template names that this context cannot supply.
 *
 * `{{action}}` is always available — every evaluation has an iteration. The
 * other two need `ctx.maxIterations`, which an engine driven without an agent
 * (a foreign host, a hand-built evaluation) does not have.
 */
export function missingFactsFor(
  template: string,
  ctx: Pick<InjectionContext, 'iteration' | 'maxIterations'>,
): readonly string[] {
  if (ctx.maxIterations !== undefined) return [];
  return placeholdersIn(template).filter(
    (name) => name === 'actionBudget' || name === 'actionsRemaining',
  );
}

/**
 * Render, or `undefined` when any named fact is unavailable.
 *
 * ALL-OR-NOTHING by design: a template that says "action 25 of {{gap}}" is
 * worse than no instruction at all, and a template that quietly renders
 * "action 25 of 0" is worse again — the library cannot tell a fabricated zero
 * from a real one, and neither can the model.
 */
export function renderTemplate(
  template: string,
  ctx: Pick<InjectionContext, 'iteration' | 'maxIterations'>,
): string | undefined {
  if (missingFactsFor(template, ctx).length > 0) return undefined;
  const max = ctx.maxIterations;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    switch (name) {
      case 'action':
        return String(ctx.iteration);
      case 'actionBudget':
        return max === undefined ? whole : String(max);
      case 'actionsRemaining':
        return max === undefined ? whole : String(iterationsRemainingOf(max, ctx.iteration));
      default:
        // Unreachable through the factories — `assertKnownFacts` refused it at
        // define time. Left as written rather than blanked, so a template that
        // somehow got here is diagnosable instead of silently gappy.
        return whole;
    }
  });
}
