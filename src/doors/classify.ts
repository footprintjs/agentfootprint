/**
 * agentfootprint/classify — a calibrated judge you plug in.
 *
 * A classifier is not a model that generates text. Handed a state and a set
 * of typed questions — pick one of these options, is this true, where on
 * this scale — it scores the DECLARED candidates from one reading and
 * answers with a distribution, a confidence, a probability. The answer comes
 * with its evidence, and the schema holds by construction
 * (docs/design/2026-09-scored-choice.md).
 *
 * Two places the agent spends one:
 *
 *   • `.findings({ judge })` — a second source on the findings ledger: after
 *     every tool result the judge is asked what that result is worth for the
 *     proposition the model declared (or the user's question), and its
 *     standing, distribution, confidence and cost land as a `JudgmentRow`
 *     beside the model's own standing. Two sources, two rows, never merged.
 *   • `classifierScorer(classifier)` on `agentfootprint/skill-graph` — an
 *     `EntryScorer` whose ranking IS the provider's distribution.
 *
 * Adapters: `typesafe()` (TypeSafe "System One", model `jev`; key from
 * `TYPESAFE_API_KEY`) and `mockClassifier()` for tests and the bench. Bring
 * your own by implementing `Classifier`.
 *
 * @example
 * ```ts
 * import { typesafe } from 'agentfootprint/classify';
 *
 * const agent = Agent.create({ provider, model })
 *   .tool(search)
 *   .findings({ judge: typesafe() })
 *   .build();
 * ```
 */

export * from '../classify/index.js';
