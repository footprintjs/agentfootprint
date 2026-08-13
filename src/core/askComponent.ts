/**
 * askComponent — the typed-HITL component payload, and its ONE grammar owner.
 *
 * A pause that asks a person something has always carried the question as
 * PROSE. This file adds the optional typed half: WHICH registered screen
 * component should collect the answer, and the props it renders with. The
 * registry itself lives in the FRONTEND — this library ships ids and props,
 * never markup and never code, so a model (or a tool) can nominate a picker
 * without ever being allowed to author one (the no-eval law).
 *
 * ── The shape, and why it is three fields ────────────────────────────────────
 *   • `componentId` — consumer vocabulary, exactly like an artifact `kind`:
 *     meaningful to whoever registered the component, opaque here.
 *   • `props` — small inline JSON. It rides the ask, which rides the
 *     CHECKPOINT, so it is for the payloads a checkpoint can afford.
 *   • `propsRef` — a claim ticket (`art_…`) for the big half. A 200-option
 *     picker's options belong in the ARTIFACT STORE, not in every stored
 *     session envelope; the screen redeems the ref through the same wire
 *     `head`/`get` every other artifact rides, under the same session scope.
 *
 * ── Who mints `propsRef` ─────────────────────────────────────────────────────
 * Usually the tool that is about to ask: `ctx.artifacts.put(...)` first, then
 * `askHuman({ question, component: { componentId, propsRef: meta.ref } })`.
 * The ask API only CARRIES the ref — and the dispatch loop validates it
 * RESOLVES in the run's own scope at raise time, so a dangling ref is refused
 * at its source instead of being discovered by the screen (see
 * `InvalidAskComponentError`).
 *
 * This is the LEAF that owns the shape, the shape refusal, and the one duck
 * reader of `component` on a pause payload. Zero runtime imports beyond a
 * type, so `core/pause.ts`, `core/checkin.ts` and `hosting/types.ts` can all
 * speak it without a cycle.
 */

import type { ArtifactRef } from '../artifacts/types.js';

/**
 * The typed half of a human ask: which REGISTERED screen component collects
 * the answer, and what it renders with.
 *
 * Optional everywhere it appears — an ask without one is byte-identical to
 * every earlier release, and a screen that does not know the id falls back to
 * the prose `question` it always had. The decision the person makes returns
 * through the SAME structured field it always did (`HostRequest.decision`,
 * `checkInApproved` / `checkInDeclined`): the component changes how the
 * question is ASKED, never what the answer IS. The words a screen renders the
 * decision as are display; the structured decision is the record.
 */
export interface AskComponent {
  /**
   * The id of a component registered in the consuming frontend — consumer
   * vocabulary, declared by whoever raises the ask, never interpreted here.
   * The registry maps it to a real component; this library never ships
   * markup or code under it (the no-eval law).
   */
  readonly componentId: string;
  /**
   * Small inline props (plain JSON). These ride the ask — and therefore the
   * checkpoint and every stored session envelope — so keep them small; the
   * big half is what {@link propsRef} is for.
   */
  readonly props?: Readonly<Record<string, unknown>>;
  /**
   * Claim ticket for the big half — an artifact ref minted BEFORE the ask
   * (usually by the asking tool via `ctx.artifacts.put`). The options table
   * rides the STORE, not the checkpoint; the screen redeems it through the
   * artifact wire under the session's own scope. Validated to resolve at
   * raise time.
   */
  readonly propsRef?: ArtifactRef;
}

/** Why an ask's component was refused at its source. */
export type AskComponentRefusalReason = 'shape' | 'no-store' | 'unresolved-ref';

/**
 * An ask nominated a component this run cannot honor as stated — a malformed
 * shape, a `propsRef` with no artifact store attached, or a `propsRef` that
 * does not resolve in the run's own scope.
 *
 * Raised AT THE SOURCE — the moment the ask is raised — and it fails the run
 * loudly rather than pausing: a pause whose component the screen cannot
 * render is a question a person half-receives, and a consent gate silently
 * downgraded to prose (or to nothing) is the accepted-and-silently-wrong
 * failure this refusal exists to prevent. The author fixes the ask; nothing
 * was executed behind anyone's back.
 */
export class InvalidAskComponentError extends Error {
  readonly code = 'ERR_INVALID_ASK_COMPONENT' as const;
  /** Which rule refused. */
  readonly reason: AskComponentRefusalReason;
  /** The door the component arrived through (`askHuman`, `ask middleware '<name>'`,
   *  `tool '<name>' checkInComponent`, …). */
  readonly door: string;
  /** The ref that could not be honored, when the refusal is about one. */
  readonly ref?: ArtifactRef;

  constructor(reason: AskComponentRefusalReason, door: string, detail: string, ref?: ArtifactRef) {
    super(`[askComponent] ${door} refused: ${detail}`);
    this.name = 'InvalidAskComponentError';
    this.reason = reason;
    this.door = door;
    if (ref !== undefined) this.ref = ref;
  }
}

/**
 * Refuse a malformed component BY NAME, at whichever door it arrived through.
 *
 * Deliberately checks the three fields and nothing more: `componentId` is
 * consumer vocabulary (no charset opinion beyond "say something"), `props`
 * must be a plain object because it is spread into JSON payloads, and
 * `propsRef` must be a non-empty string because an empty ticket resolves
 * nothing. Whether the ref RESOLVES is a runtime question answered at raise
 * time by the dispatch loop, not here — this leaf has no store.
 */
export function assertAskComponent(value: unknown, door: string): asserts value is AskComponent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidAskComponentError(
      'shape',
      door,
      `component must be an object { componentId, props?, propsRef? }, got ${describe(value)}. ` +
        `componentId names a component REGISTERED in your frontend; props is small inline ` +
        `JSON; propsRef is an artifact ref for the big half.`,
    );
  }
  const c = value as { componentId?: unknown; props?: unknown; propsRef?: unknown };
  if (typeof c.componentId !== 'string' || c.componentId.trim().length === 0) {
    throw new InvalidAskComponentError(
      'shape',
      door,
      `component.componentId must be a non-empty string (got ${describe(c.componentId)}). It ` +
        `is the id your frontend registered the component under — the screen picks the ` +
        `renderer from it, so an ask without one has nothing to render.`,
    );
  }
  if (
    c.props !== undefined &&
    (typeof c.props !== 'object' || c.props === null || Array.isArray(c.props))
  ) {
    throw new InvalidAskComponentError(
      'shape',
      door,
      `component.props must be a plain object when present (got ${describe(c.props)}). It is ` +
        `the small inline half — for a list of options or anything big, mint an artifact ` +
        `and pass its ref as component.propsRef instead.`,
    );
  }
  if (c.propsRef !== undefined && (typeof c.propsRef !== 'string' || c.propsRef.length === 0)) {
    throw new InvalidAskComponentError(
      'shape',
      door,
      `component.propsRef must be a non-empty artifact ref string when present (got ` +
        `${describe(c.propsRef)}) — the ticket ctx.artifacts.put(...) handed back.`,
    );
  }
}

/**
 * The ONE reader of `component` on a pause payload — wherever the pause kind
 * happens to keep it.
 *
 * A plain `askHuman` / `pauseHere` pause carries it at the TOP of `pauseData`
 * (the tool's own bag, spread by the dispatch loop); a check-in keeps it on
 * the typed request under `pauseData.checkIn`; a middleware ask keeps it on
 * the question under `pauseData.ask`. The kinds are mutually exclusive, so at
 * most one home is occupied — and every consumer that wants "the component of
 * this pause, whatever kind it is" asks HERE, so the homes cannot drift apart
 * from their readers.
 *
 * Duck-shaped on purpose (`pauseData` is uninterpreted caller data): a value
 * that is not a plausible component is reported absent, never guessed at.
 */
export function readAskComponent(pauseData: unknown): AskComponent | undefined {
  if (typeof pauseData !== 'object' || pauseData === null) return undefined;
  const bag = pauseData as {
    component?: unknown;
    checkIn?: { component?: unknown };
    ask?: { component?: unknown };
  };
  const candidate =
    bag.component ??
    (typeof bag.checkIn === 'object' && bag.checkIn !== null ? bag.checkIn.component : undefined) ??
    (typeof bag.ask === 'object' && bag.ask !== null ? bag.ask.component : undefined);
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const c = candidate as { componentId?: unknown };
  if (typeof c.componentId !== 'string' || c.componentId.length === 0) return undefined;
  return candidate as AskComponent;
}

/** Name the SHAPE of a bad value for a refusal — never its contents. */
function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const t = typeof value;
  return t === 'object' ? 'an object' : t === 'string' ? 'an empty/blank string' : `a ${t}`;
}
