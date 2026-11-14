import type { OutputSchemaParser } from '../../../../answer-validation/outputSchema.js';
import {
  validateCannedAgainstSchema,
  type OutputFallbackFn,
  type OutputFallbackOptions,
  type ResolvedOutputFallback,
} from '../../../outputFallback.js';

export interface OutputFallbackPort {
  outputFallbackCfg?: ResolvedOutputFallback<unknown>;
  outputSchemaParser?: OutputSchemaParser<unknown>;
}

export function configureOutputFallback<T>(
  self: OutputFallbackPort,
  options: OutputFallbackOptions<T>,
  original: object,
): object {
  if (self.outputFallbackCfg) {
    throw new Error(
      'AgentBuilder.outputFallback: already set. Each agent has at most one fallback chain.',
    );
  }
  self.outputFallbackCfg = {
    fallback: options.fallback as OutputFallbackFn<unknown>,
    ...(options.canned !== undefined && { canned: options.canned as unknown }),
    hasCanned: options.canned !== undefined,
  };
  // The coherence check moved to `build()` in 8.18.0 — see
  // `assertOutputFallbackCoherent`. What it needs (a parser) is a fact about
  // the FINISHED agent, and the builder is a bag of settings in whatever
  // order they were written.
  return original;
}

export function assertOutputFallbackCoherent(self: Readonly<OutputFallbackPort>): void {
  const cfg = self.outputFallbackCfg;
  if (cfg === undefined) return;
  if (!self.outputSchemaParser) {
    throw new Error(
      'AgentBuilder.build: .outputFallback() is configured but .outputSchema(parser) is not. ' +
        'A fallback is what happens when the terminal contract is not met, so without a ' +
        'contract there is nothing for it to catch and its tiers can never run. Add ' +
        '.outputSchema(parser) — in either order, they are one setting made of two calls — ' +
        'or drop the fallback.',
    );
  }
  // The safety net must always validate; a `canned` value that does not is a
  // misconfiguration that would only surface AFTER the agent loop had
  // already failed, which is the one moment it exists to survive.
  if (cfg.hasCanned) {
    validateCannedAgainstSchema(cfg.canned, self.outputSchemaParser as OutputSchemaParser<unknown>);
  }
}
