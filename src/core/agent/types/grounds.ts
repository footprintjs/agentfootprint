import type { ExternalGround } from '../../../integrity/unsupported-argument/check.js';

/**
 * The app's external-ground door for the choice-seam integrity check
 * (9.72.0) — see {@link AgentOptions.externalGrounds}. Yields the entries the
 * app currently vouches for; consulted once per LLM response that contains an
 * armed call. Must be synchronous: the values are things the app already
 * verified and holds (a clicked selection), never something to go fetch.
 */
export type ExternalGroundsProvider = () => readonly ExternalGround[];
