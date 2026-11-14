import { defineInstruction } from '../../../../injection-engine/factories/defineInstruction.js';
import type { Injection } from '../../../../injection-engine/types.js';
import { ONTOLOGY_INSTRUCTION, ONTOLOGY_INSTRUCTION_ID } from '../../../../ontology/instruction.js';
import type { RecipeSource } from '../../../../recipes/provenance.js';
import type { AgentOptions } from '../../types.js';

export interface OntologyPort {
  ontologyValue?: NonNullable<AgentOptions['ontology']>;
  readonly injectionList: Injection[];
  readonly injectionSources: Map<string, RecipeSource>;
  currentSource(): RecipeSource;
}

export function configureOntology(
  self: OntologyPort,
  ontology: NonNullable<AgentOptions['ontology']>,
  options: { readonly ask?: NonNullable<AgentOptions['ontologyAsk']> } | undefined,
  original: object,
): object {
  const ask = options?.ask;
  if (ask !== undefined && ask !== 'none' && ask !== 'use-the-map') {
    throw new Error(
      `AgentBuilder.ontology: ask must be 'none' or 'use-the-map', got ${JSON.stringify(ask)}.`,
    );
  }
  if (self.ontologyValue !== undefined) {
    throw new Error(
      'AgentBuilder.ontology: already set. One map per agent — a second call would register ' +
        'the ask twice and leave two maps with the later one silently winning. Compose one ' +
        'declaration and pass it once.',
    );
  }
  if (
    ontology === null ||
    typeof ontology !== 'object' ||
    typeof ontology.id !== 'string' ||
    typeof ontology.version !== 'string' ||
    typeof ontology.hash !== 'string' ||
    ontology.hash.length === 0 ||
    !Object.isFrozen(ontology) ||
    ontology.nodes === null ||
    typeof ontology.nodes !== 'object' ||
    ontology.sources === null ||
    typeof ontology.sources !== 'object' ||
    !Array.isArray(ontology.edges)
  ) {
    throw new Error(
      'AgentBuilder.ontology: expected the frozen Ontology `defineOntology(spec)` returns ' +
        '(agentfootprint/ontology), not a bare spec — the definition is where the declaration ' +
        'is validated and fingerprinted.',
    );
  }
  self.ontologyValue = ontology;
  // `'none'`: the map as data, no ask of the library's — the application
  // registers its own through `.instruction()`. Nothing else differs.
  if (ask === 'none') return original;
  // The always-on ask — the `outputSchema()` twin: a system-slot instruction
  // that activates every iteration, so a long run keeps the vocabulary
  // present, and a system PIECE on the receipt (never an injected turn).
  self.injectionList.push(
    defineInstruction({
      id: ONTOLOGY_INSTRUCTION_ID,
      activeWhen: () => true,
      prompt: ONTOLOGY_INSTRUCTION,
    }),
  );
  self.injectionSources.set(ONTOLOGY_INSTRUCTION_ID, self.currentSource());
  return original;
}
