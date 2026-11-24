import type { TypedScope } from 'footprintjs';
import { withFindingsArgument, withSourcesArgument } from '../findings/reserved.js';
import { sourceSchemasOnWire } from '../sourceContract.js';
import type { AgentState } from '../types.js';
import type { SeedStageDeps } from './seed.js';

/** The inputs layer's schema decoration (`arguments/serve/schema.ts` · `withArgumentRules`). */
export type RuleDecoration = typeof import('../arguments/serve.js').withArgumentRules;

/**
 * The inputs layer's schema decoration for THIS run's seed — loaded through
 * `import()` only when a registered tool is ruled (`deps.ruledTools`), the
 * optional-family law of docs-next's site budget; `undefined` otherwise, so
 * an agent without the layer seeds with no new await and no new microtask.
 */
export function loadRuleDecoration(
  deps: Pick<SeedStageDeps, 'ruledTools'>,
): Promise<RuleDecoration> | undefined {
  return deps.ruledTools === undefined
    ? undefined
    : import('../arguments/serve.js').then((m) => m.withArgumentRules);
}

/** Seed the static tool schemas used until the Tools slot supplies the actual offer. */
export function seedToolSchemas(
  scope: TypedScope<AgentState>,
  deps: Pick<SeedStageDeps, 'toolSchemas' | 'ruledTools' | 'argumentSources' | 'findings'>,
  decorate: RuleDecoration | undefined,
): void {
  // The static fallback shares the slot's ONE decorator (9.101.0): armed, the
  // first call serves decorated schemas exactly as every later call will;
  // unarmed, the registry list by reference, byte for byte. NO OFFER here
  // (9.102.0): at seed there is no served history and nothing to name, so the
  // base decoration — an explicit lambda, because passed point-free `.map`
  // would hand the index in as the offer (`reserved.ts · withFindingsArgument`).
  // The inputs layer's rules decorate FIRST (honesty layer 2) — the slot's
  // order: rules, then `_findings`. Only when a registered tool is ruled. One
  // options value for every schema here, where the slot decides per schema
  // (`ownsReservedArgument`): the seed serves REGISTERED tools only, and under
  // declared sources a registered ruled tool whose author owns `_findings` is
  // refused at build (`buildToolRegistry` · `assertReservedArgument`) — so
  // every ruled schema here carries the `_findings.from` its sentence names.
  const ruledTools = deps.ruledTools;
  const ruleOptions = deps.argumentSources === true ? { sources: true } : undefined;
  const ruled =
    ruledTools === undefined || decorate === undefined
      ? deps.toolSchemas
      : deps.toolSchemas.map((s) => decorate(s, ruledTools.get(s.name), ruleOptions));
  // Declared sources (honesty layer 2): a ruled tool's decoration carries `from` —
  // inside the ledger's `_findings` under `.findings()`, or as the reserved
  // argument's only property without it (the slot's `sourcesOnWire` twin).
  scope.dynamicToolSchemas = sourceSchemasOnWire(
    ruled,
    ruledTools,
    deps.findings === true,
    deps.argumentSources === true,
    withFindingsArgument,
    withSourcesArgument,
  );
}
