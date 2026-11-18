import type { Injection } from '../../../../injection-engine/types.js';
import type { RecipeSource } from '../../../../recipes/provenance.js';
import { findingsInstruction } from '../../findings/instruction.js';
import { findingsContextBytes } from '../../findings/context.js';
import { FINDINGS_INSTRUCTION_ID } from '../../findings/reserved.js';
import type { AgentOptions } from '../../types.js';

export interface FindingsPort {
  findingsValue?: NonNullable<AgentOptions['findings']>;
  readonly injectionList: Injection[];
  readonly injectionSources: Map<string, RecipeSource>;
  currentSource(): RecipeSource;
}

export function configureFindings(
  self: FindingsPort,
  options: NonNullable<AgentOptions['findings']> | undefined,
  original: object,
): object {
  if (self.findingsValue !== undefined) {
    throw new Error(
      'AgentBuilder.findings: already set. One findings ledger per agent — a second call ' +
        'would register the ask twice and leave two option sets with the later one silently ' +
        'winning. Pass every option in the one call.',
    );
  }
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new Error(
      `AgentBuilder.findings: expected an options object or nothing, got ${typeof options}.`,
    );
  }
  const maxContextBytes = findingsContextBytes(options?.maxContextBytes);
  const serve = options?.serve ?? 'ledger-and-facts';
  if (serve !== 'ledger-and-facts' && serve !== 'ledger-only') {
    throw new Error(
      `AgentBuilder.findings: serve must be 'ledger-and-facts' or 'ledger-only', got ` +
        `${JSON.stringify(serve)}.`,
    );
  }
  const answerAsk = options?.answerAsk;
  if (answerAsk !== undefined && answerAsk !== 'none' && answerAsk !== 'quote-facts') {
    throw new Error(
      `AgentBuilder.findings: answerAsk must be 'none' or 'quote-facts', got ` +
        `${JSON.stringify(answerAsk)}.`,
    );
  }
  const keep = options?.keepLedgerFacts;
  if (keep !== undefined && keep !== false && !(Number.isInteger(keep) && keep >= 0)) {
    throw new Error(
      `AgentBuilder.findings: keepLedgerFacts must be a non-negative integer or false, got ` +
        `${JSON.stringify(keep)}.`,
    );
  }
  // The judge (9.104.0) is a port: refused at build unless it has the
  // port's two members, so a misconfigured classifier fails here rather
  // than as an error row on every tool result.
  const judge = options?.judge;
  if (
    judge !== undefined &&
    (judge === null ||
      typeof judge !== 'object' ||
      typeof judge.name !== 'string' ||
      judge.name === '' ||
      typeof judge.classify !== 'function')
  ) {
    throw new Error(
      'AgentBuilder.findings: judge must be a Classifier — `{ name: string; classify(request, ' +
        'signal?) }` from agentfootprint/classify (`typesafe()`, `mockClassifier()`, or your own).',
    );
  }
  // Declared sources (honesty layer 2): a boolean, or nothing. It needs the
  // inputs layer, which only the whole agent can say is armed — `Agent`
  // refuses it at build when no ruled tool and no `.inputsLayer()` arm one.
  // (`.inputsLayer({ argumentSources: true })` arms the same thing without
  // this ledger.)
  const argumentSources = options?.argumentSources;
  if (argumentSources !== undefined && typeof argumentSources !== 'boolean') {
    throw new Error(
      `AgentBuilder.findings: argumentSources must be true or false, got ` +
        `${JSON.stringify(argumentSources)}.`,
    );
  }
  // `answerAsk` is stored as given, never normalised: `'none'` is the
  // default and `Agent.ts` threads the dial only under `'quote-facts'`, so
  // an explicit `'none'` and an absent one reach the run as the same thing.
  self.findingsValue = {
    serve,
    maxContextBytes,
    ...(answerAsk !== undefined && { answerAsk }),
    ...(keep !== undefined && { keepLedgerFacts: keep }),
    ...(judge !== undefined && { judge }),
    ...(argumentSources === true && { argumentSources: true }),
  };
  // The always-on ask — the `outputSchema()` twin: a system-slot instruction
  // that activates every iteration, so a long run keeps the vocabulary
  // present, and a system PIECE on the receipt (never an injected turn, so
  // nothing in it is exempt from the evidence gate and nothing persists).
  self.injectionList.push(findingsInstruction(false, answerAsk === 'quote-facts'));
  self.injectionSources.set(FINDINGS_INSTRUCTION_ID, self.currentSource());
  return original;
}
