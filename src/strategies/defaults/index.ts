/**
 * Default strategies — the four "shipped in core" sinks.
 *
 *   `consoleObservability`   — print events to console
 *   `inMemorySinkCost`       — accumulate cost ticks in a process-local buffer
 *   `chatBubbleLiveStatus`   — call a consumer-supplied line callback
 *   `noopLens`               — drop graph updates (zero-arg fallback)
 *
 * Vendor strategies (datadog, otel, agentcore, cloudwatch, …) ship as
 * separate subpaths with peer-dep on the vendor SDK. See
 * `docs/inspiration/strategy-everywhere.md` for the AWS-first roadmap.
 *
 * ─────────────────────────────────────────────────────────────────
 * Why defaults skip `validate()`:
 *
 * The optional `BaseStrategy.validate()` hook is the right place for
 * runtime config checks (API keys, endpoint reachability, peer-dep
 * presence). Defaults skip it by design — their inputs are TypeScript-
 * checked at construction, and they don't talk to a remote vendor that
 * might be misconfigured.
 *
 * Vendor strategies that DO talk to a remote (datadog, agentcore,
 * cloudwatch) MUST implement `validate()` per the New Relic panel
 * review — early-fail-with-useful-message beats silent zero-emission.
 * ─────────────────────────────────────────────────────────────────
 */

export { consoleObservability, type ConsoleObservabilityOptions } from './consoleObservability.js';
export {
  inMemorySinkCost,
  type InMemorySinkCostOptions,
  type InMemorySinkCostStrategy,
} from './inMemorySinkCost.js';
export { chatBubbleLiveStatus, type ChatBubbleLiveStatusOptions } from './chatBubbleLiveStatus.js';
export { noopLens, type NoopLensOptions } from './noopLens.js';
