/**
 * Strategy registry — name → factory for each of the 4 groups.
 *
 * Mirrors `src/cache/strategyRegistry.ts` exactly: maps a string name
 * to a factory function that takes vendor-specific config and returns
 * a typed strategy instance. Vendor adapter subpaths self-register on
 * import via side-effect.
 *
 * Two ways consumers wire a strategy:
 *
 *   1. By NAME (registry lookup) — the recommended path for vendor
 *      adapters:
 *        ```ts
 *        import 'agentfootprint/observability-datadog';  // self-registers 'datadog'
 *        agent.enable.observability({ vendor: 'datadog', config: { apiKey } });
 *        ```
 *
 *   2. By INSTANCE (explicit pass) — for custom in-house strategies
 *      or test mocks:
 *        ```ts
 *        agent.enable.observability({ strategy: myCustomStrategy });
 *        ```
 *
 * The two paths are mutually exclusive in `EnableOptions` — the type
 * union enforces that consumers pick one.
 *
 * Lookup is exact-match by name (case-insensitive fallback). Unknown
 * names return `undefined`; the consumer's `enable.X` then no-ops
 * (per "do nothing if not configured" rule).
 */

import type {
  ObservabilityStrategy,
  CostStrategy,
  LiveStatusStrategy,
  LensStrategy,
} from './types.js';

// ─── Factory shapes ──────────────────────────────────────────────────

/** Vendor adapter subpaths register a factory keyed by their vendor
 *  name. Config shape is vendor-specific — type-erased at the registry
 *  boundary; consumer's responsibility to pass the right shape. */
export type ObservabilityFactory = (config?: unknown) => ObservabilityStrategy;
export type CostFactory = (config?: unknown) => CostStrategy;
export type LiveStatusFactory = (config?: unknown) => LiveStatusStrategy;
export type LensFactory = (config?: unknown) => LensStrategy;

// ─── 4 registries (one per group) ────────────────────────────────────

const OBSERVABILITY_REGISTRY = new Map<string, ObservabilityFactory>();
const COST_REGISTRY = new Map<string, CostFactory>();
const LIVE_STATUS_REGISTRY = new Map<string, LiveStatusFactory>();
const LENS_REGISTRY = new Map<string, LensFactory>();

// ─── Register / lookup / list — observability ────────────────────────

/**
 * Register a vendor observability strategy by name. Called from the
 * vendor's subpath at module load (side-effect import):
 *
 *   ```ts
 *   // agentfootprint/observability-datadog/index.ts
 *   import { registerObservabilityStrategy } from 'agentfootprint/strategies';
 *   registerObservabilityStrategy('datadog', (config) => datadogObservability(config));
 *   ```
 *
 * Replacing an existing registration is allowed — most-recent wins.
 * Useful for test mocks.
 */
export function registerObservabilityStrategy(name: string, factory: ObservabilityFactory): void {
  OBSERVABILITY_REGISTRY.set(name, factory);
}

/** Look up an observability factory by vendor name. Case-insensitive
 *  fallback. Returns `undefined` when the name is unknown — caller
 *  decides to noop or throw. */
export function getObservabilityStrategy(name: string): ObservabilityFactory | undefined {
  return OBSERVABILITY_REGISTRY.get(name) ?? OBSERVABILITY_REGISTRY.get(name.toLowerCase());
}

/** Diagnostic — list all registered vendor names. */
export function listObservabilityStrategies(): readonly string[] {
  return [...OBSERVABILITY_REGISTRY.keys()];
}

// ─── Cost ────────────────────────────────────────────────────────────

export function registerCostStrategy(name: string, factory: CostFactory): void {
  COST_REGISTRY.set(name, factory);
}

export function getCostStrategy(name: string): CostFactory | undefined {
  return COST_REGISTRY.get(name) ?? COST_REGISTRY.get(name.toLowerCase());
}

export function listCostStrategies(): readonly string[] {
  return [...COST_REGISTRY.keys()];
}

// ─── Live status ─────────────────────────────────────────────────────

export function registerLiveStatusStrategy(name: string, factory: LiveStatusFactory): void {
  LIVE_STATUS_REGISTRY.set(name, factory);
}

export function getLiveStatusStrategy(name: string): LiveStatusFactory | undefined {
  return LIVE_STATUS_REGISTRY.get(name) ?? LIVE_STATUS_REGISTRY.get(name.toLowerCase());
}

export function listLiveStatusStrategies(): readonly string[] {
  return [...LIVE_STATUS_REGISTRY.keys()];
}

// ─── Lens ────────────────────────────────────────────────────────────

export function registerLensStrategy(name: string, factory: LensFactory): void {
  LENS_REGISTRY.set(name, factory);
}

export function getLensStrategy(name: string): LensFactory | undefined {
  return LENS_REGISTRY.get(name) ?? LENS_REGISTRY.get(name.toLowerCase());
}

export function listLensStrategies(): readonly string[] {
  return [...LENS_REGISTRY.keys()];
}

// ─── Test helpers ────────────────────────────────────────────────────

/** Reset every registry to empty. Tests only — not in the public
 *  barrel. */
export function _resetRegistriesForTests(): void {
  OBSERVABILITY_REGISTRY.clear();
  COST_REGISTRY.clear();
  LIVE_STATUS_REGISTRY.clear();
  LENS_REGISTRY.clear();
}
