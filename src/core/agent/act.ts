/**
 * act — PUBLIC. One bundle for every place a rule may speak.
 *
 * Pattern: Facade over five doors, with the facade's KEYS type-locked to the
 *          list of moments they cover.
 * Role:    core/ layer. `.act()` builds nothing new: it validates a bundle
 *          and calls `.messageMiddleware()`, `.toolMiddleware()` and
 *          `.window()` with exactly what a person would have passed by hand.
 *          Everything about a run is decided by those doors, here and there
 *          alike.
 * Emits:   N/A.
 *
 * ## Why a bundle at all, when the doors already exist
 *
 * Because the doors are findable one at a time and the POSTURE is not. An
 * agent's governance currently reads as four unrelated calls scattered
 * through a builder chain, and the question a reviewer actually has —
 * "what does this agent do at each point in its loop?" — has no place to be
 * answered. `.act({ … })` is that place: five optional keys, named for the
 * five moments, so autocomplete on an empty object teaches the loop.
 *
 * ## The completeness lock
 *
 * The keys of {@link ActOptions} are pinned, at compile time, against
 * `ActKey<LoopMoment>` — the moment list, camel-cased. Add a sixth moment to
 * `LOOP_MOMENTS` and this file stops compiling until the bundle grows the key
 * for it; delete a key and the same. A surface that claims to be complete has
 * to be made unable to fall behind, or the claim is just a sentence in a doc.
 *
 * The runtime half is derived from the same list: the accepted key set is
 * `LOOP_MOMENTS.map(actKeyFor)`, so a typo'd key is refused by a validator
 * that cannot drift from the type it is validating.
 */

import { allow } from './middleware/outcomes.js';
import type { MessageMiddleware, ToolMiddleware } from './middleware/types.js';
import { actKeyFor, LOOP_MOMENTS, type ActKey, type LoopMoment } from './moments.js';
import type { WindowStrategy } from './window/strategy.js';

/**
 * The whole steering wheel: one key per moment of the loop, each optional.
 *
 * The declaration order below is the order the loop reaches them.
 */
export interface ActOptions {
  /** The user's message, before the run commits it. */
  readonly input?: readonly MessageMiddleware[];
  /** Every tool call, before it is dispatched. */
  readonly beforeTool?: readonly ToolMiddleware[];
  /** Every tool result, after the tool ran and before the model reads it. */
  readonly afterTool?: readonly ToolMiddleware[];
  /** What the live context window keeps, at each iteration boundary. */
  readonly window?: WindowStrategy;
  /** The final answer, before the caller receives it. */
  readonly output?: readonly MessageMiddleware[];
}

/**
 * THE LOCK. `true` only while the bundle's keys are exactly the moments.
 *
 * If this line fails to compile, a moment and its key have parted company —
 * fix the bundle (or the moment list), not this line.
 */
type ExactlyTheMoments<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _keysAreExactlyTheMoments: ExactlyTheMoments<keyof ActOptions, ActKey<LoopMoment>> = true;
void _keysAreExactlyTheMoments;

/** The keys `.act()` accepts, derived from the moment list rather than typed. */
export const ACT_KEYS: readonly ActKey[] = LOOP_MOMENTS.map(actKeyFor);

/** What `.act()` hands to the five doors. */
export interface ResolvedAct {
  readonly message: readonly MessageMiddleware[];
  readonly tool: readonly ToolMiddleware[];
  readonly window?: WindowStrategy;
}

/**
 * Restrict a message middleware to ONE phase.
 *
 * `.messageMiddleware()` attaches a link to both halves of the boundary and
 * lets it read `msg.phase`; the bundle names the phases instead, so an entry
 * written for one of them is wrapped in exactly the guard a person writes by
 * hand today. The pass-through at the other phase is a real walk with a real
 * row, because it is a real link in the chain — the same run, the same
 * record, whichever spelling put it there.
 */
function onlyAt(phase: 'input' | 'output', mw: MessageMiddleware): MessageMiddleware {
  return {
    name: mw.name,
    onMessage: (msg) => (msg.phase === phase ? mw.onMessage(msg) : allow()),
  };
}

function assertList(value: unknown, key: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `AgentBuilder.act: '${key}' expects an array of middleware, got ${typeof value}. ` +
        `Wrap a single rule in an array — the bundle is a list per moment.`,
    );
  }
  return value;
}

function assertNamedHook(mw: unknown, key: string, hook: string): void {
  if (
    mw === null ||
    typeof mw !== 'object' ||
    typeof (mw as { name?: unknown }).name !== 'string' ||
    (mw as { name: string }).name.length === 0 ||
    typeof (mw as Record<string, unknown>)[hook] !== 'function'
  ) {
    throw new Error(
      `AgentBuilder.act: every '${key}' entry needs a non-empty \`name\` and a \`${hook}(...)\` ` +
        `method. The name is what every ledger row and event says decided the call, so it ` +
        `cannot be blank` +
        (hook === 'onToolCall'
          ? `; a rule that only has \`onToolResult\` belongs under 'afterTool'.`
          : hook === 'onToolResult'
          ? `; a rule that only has \`onToolCall\` belongs under 'beforeTool'.`
          : `.`),
    );
  }
}

/**
 * Validate a bundle and turn it into the arguments the five doors take.
 *
 * Pure — it throws or it returns; it touches no builder state. `.act()` is
 * the caller that hands the result to the doors, which is what makes the
 * sugar provably the same agent.
 */
export function resolveAct(options: ActOptions): ResolvedAct {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error(
      `AgentBuilder.act: expected an options object, got ${
        Array.isArray(options) ? 'an array' : typeof options
      }. The keys are ${ACT_KEYS.join(', ')}.`,
    );
  }
  for (const key of Object.keys(options)) {
    if (!(ACT_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `AgentBuilder.act: unknown key '${key}'. The loop has ${LOOP_MOMENTS.length} moments and ` +
          `this bundle has one key for each: ${ACT_KEYS.join(', ')}. A key nobody reads is a ` +
          `governance rule that silently never runs, so it is refused here rather than ignored.`,
      );
    }
  }

  // ── The message halves ──────────────────────────────────────────────
  // A link named at BOTH phases is attached once, unguarded — which is the
  // plain `.messageMiddleware(mw)` spelling, and the one that files one row
  // per phase instead of two.
  const input = assertList(options.input ?? [], 'input') as readonly MessageMiddleware[];
  const output = assertList(options.output ?? [], 'output') as readonly MessageMiddleware[];
  for (const mw of input) assertNamedHook(mw, 'input', 'onMessage');
  for (const mw of output) assertNamedHook(mw, 'output', 'onMessage');

  const message: MessageMiddleware[] = [];
  for (const mw of input) {
    message.push(output.includes(mw) ? mw : onlyAt('input', mw));
  }
  for (const mw of output) {
    if (!input.includes(mw)) message.push(onlyAt('output', mw));
  }

  // ── The tool moments ────────────────────────────────────────────────
  // One list, walked forwards for calls and backwards for results. The
  // buckets are named for the MOMENTS (`afterTool` ⇄ `'after-tool'`); the
  // hooks are named for what they RECEIVE (`onToolResult`). The bucket says
  // where a rule is MEANT to speak and is checked for the hook it names; what
  // it actually does is decided by the hooks it has, so a rule can never
  // silently fail to run because it was written in the other bucket.
  const beforeTool = assertList(
    options.beforeTool ?? [],
    'beforeTool',
  ) as readonly ToolMiddleware[];
  const afterTool = assertList(options.afterTool ?? [], 'afterTool') as readonly ToolMiddleware[];
  for (const mw of beforeTool) assertNamedHook(mw, 'beforeTool', 'onToolCall');
  for (const mw of afterTool) assertNamedHook(mw, 'afterTool', 'onToolResult');

  const tool: ToolMiddleware[] = [...beforeTool];
  for (const mw of afterTool) {
    if (!tool.includes(mw)) tool.push(mw);
  }

  return {
    message,
    tool,
    ...(options.window !== undefined && { window: options.window }),
  };
}
