import type { ActiveInjection, Injection, InjectionContext } from './types.js';
import { servedSurfaceMode } from './skillContext.js';
import { renderTemplate } from './promptTemplate.js';

/**
 * Project a full Injection (with functions) into a scope-safe POJO.
 *
 * `ctx` (9.57.0) is THE rendering seam: it is the one moment the context and
 * the content are both in scope, and every downstream reader — the slots, the
 * cache decision, Deliver, the ledger, the recorders, a foreign host —
 * continues to see the same static `ActiveInjection` it always saw. Optional,
 * so a caller from before 9.57.0 still compiles.
 *
 * A TEMPLATED injection projected with no usable ctx comes back with NO
 * `systemPrompt` at all. Absence is honest; a literal `{{actionsRemaining}}`
 * in front of the model is not. Through the engine that path is unreachable —
 * `evaluateInjections` has already skipped such an injection by name.
 */
export function projectActiveInjection(
  inj: Injection,
  ctx?: Pick<InjectionContext, 'iteration' | 'maxIterations'> & Partial<InjectionContext>,
): ActiveInjection {
  // Per-skill metadata the slots dispatch on: `surfaceMode` (suppression), `autoActivate` (the
  // tools slot readmits a scoped skill's tools while it is active).
  const meta = inj.metadata as
    | { surfaceMode?: string; autoActivate?: string; cache?: unknown; skillContext?: unknown }
    | undefined;
  // Rendered HERE, once, so the projection every reader shares is already
  // plain text. `undefined` = a template whose facts this ctx cannot supply,
  // and then the piece is absent rather than gappy.
  const systemPrompt =
    inj.templated === true && inj.inject.systemPrompt !== undefined
      ? ctx === undefined
        ? undefined
        : renderTemplate(inj.inject.systemPrompt, ctx)
      : inj.inject.systemPrompt;
  const surfaceMode = servedSurfaceMode(meta, inj.id, inj.inject.systemPrompt, ctx?.history);
  const out: ActiveInjection = {
    id: inj.id,
    flavor: inj.flavor,
    ...(inj.description && { description: inj.description }),
    // `listed` (`injection-engine/skillContext.ts`): `tool-only` exactly while the read_skill result is in history.
    ...(surfaceMode && { surfaceMode: surfaceMode as ActiveInjection['surfaceMode'] }),
    ...(meta?.autoActivate && {
      autoActivate: meta.autoActivate as ActiveInjection['autoActivate'],
    }),
    // The cache directive rides across too — see the field's note. Without it
    // the cache decision reads `undefined` for every injection and defaults to
    // "never cacheable", which silently discards what the consumer declared.
    ...(meta?.cache !== undefined && {
      cache: meta.cache as ActiveInjection['cache'],
    }),
    inject: {
      ...(systemPrompt !== undefined && systemPrompt.length > 0 && { systemPrompt }),
      ...(inj.inject.messages && { messages: inj.inject.messages.map((m) => ({ ...m })) }),
      ...(inj.inject.tools && {
        tools: inj.inject.tools.map((t) => ({
          schema: { ...t.schema },
          injectionId: inj.id,
        })),
      }),
    },
  };
  return out;
}
