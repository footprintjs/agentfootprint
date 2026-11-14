import {
  buildDefaultInstruction,
  type OutputSchemaOptions,
  type OutputSchemaParser,
  type OutputSchemaStrategy,
} from '../../../../answer-validation/outputSchema.js';
import { defineInstruction } from '../../../../injection-engine/factories/defineInstruction.js';
import type { Injection } from '../../../../injection-engine/types.js';
import type { RecipeSource } from '../../../../recipes/provenance.js';
import { resolveRetries } from './retries.js';

export interface OutputSchemaPort {
  outputSchemaParser?: OutputSchemaParser<unknown>;
  outputSchemaRetries: number;
  outputSchemaStrategy: OutputSchemaStrategy;
  outputSchemaJson?: Readonly<Record<string, unknown>>;
  readonly injectionList: Injection[];
  readonly injectionSources: Map<string, RecipeSource>;
  currentSource(): RecipeSource;
}

export function configureOutputSchema<T>(
  self: OutputSchemaPort,
  parser: OutputSchemaParser<T>,
  opts: OutputSchemaOptions | undefined,
  original: object,
): object {
  if (self.outputSchemaParser) {
    throw new Error(
      'AgentBuilder.outputSchema: already set. Each agent has at most one terminal contract.',
    );
  }
  self.outputSchemaParser = parser as OutputSchemaParser<unknown>;
  self.outputSchemaRetries = resolveRetries(opts?.retries);
  self.outputSchemaStrategy = opts?.strategy ?? 'auto';
  if (opts?.jsonSchema !== undefined) self.outputSchemaJson = opts.jsonSchema;
  const instructionText = opts?.instruction ?? buildDefaultInstruction(parser);
  const id = opts?.name ?? 'output-schema';
  // Always-on system-slot instruction. Activates every iteration so
  // long runs keep the contract present (recency-first redundancy).
  self.injectionList.push(
    defineInstruction({
      id,
      activeWhen: () => true,
      prompt: instructionText,
    }),
  );
  // The SECOND door into the injection list (`.injection()` is the other), so
  // it records provenance too: without this the id would read as
  // "unattributed" in a later collision — an honest answer, but a worse one
  // than the true "the recipe/app that called .outputSchema() mounted it".
  self.injectionSources.set(id, self.currentSource());
  return original;
}
