/**
 * llmClassifier — an {@link IntentScorer} that asks a model which declared
 * intent the new message is (SG-C tier 2). ONE call per turn, off the hot
 * loop, in the RouteTurn stage — never inside the ReAct iterations.
 *
 * **Constrained enum, never free text.** On a provider that declares
 * `carriesForcedToolChoice` the pick rides a forced synthetic tool whose
 * single argument is `enum: [...candidateIds, 'none']` (the same machinery
 * the `'tool-forced'` output strategy uses); on any other provider it is a
 * strict single-line parse validated against the enum, ONE structured re-ask,
 * then `'none'`. An off-enum answer is a parse failure, not a route — this
 * scorer can never emit an id it wasn't given.
 *
 * Output maps to scores the framework can judge: picked id → 1, others → 0;
 * `'none'` → all 0. `floor: 0` (so `'none'` is honestly "unmatched") and
 * `categorical: true` (one id or none — a pick is decisive by construction,
 * never diluted by the near-tie margin; see `routingPolicy.ts`).
 *
 * The only injection-engine scorer module that imports `adapters/types` —
 * kept out of `entryScorer.ts` so the keyword/embedding paths stay
 * adapter-free.
 */

import type { LLMProvider, LLMRequest, LLMResponse, LLMToolSchema } from '../../adapters/types.js';
import type {
  IntentCandidate,
  IntentScore,
  IntentScorer,
  IntentScorerInput,
} from './intentScorer.js';

export interface LlmClassifierOptions {
  /** Model to classify with. Name it for any real provider — left unset, the
   *  request carries an empty model id, which only the mock tolerates. */
  readonly model?: string;
  /** Recent-turns window (count of prior conversational turns shown to the
   *  classifier). Absent = current message only. */
  readonly window?: number;
  /** Prompt budget: examples listed per intent. Default 5. */
  readonly maxExamplesPerIntent?: number;
}

const PICK_TOOL = 'pick_intent';
const NONE = 'none';

/** Build the classifier. See the module header for the enum discipline. */
export function llmClassifier(
  provider: LLMProvider,
  options: LlmClassifierOptions = {},
): IntentScorer {
  const maxExamples = options.maxExamplesPerIntent ?? 5;
  return {
    name: 'llm-classifier',
    floor: 0,
    categorical: true,
    ...(options.window !== undefined && { window: options.window }),
    async score(input, candidates, signal): Promise<readonly IntentScore[]> {
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.id);
      const allowed = [...ids, NONE];
      const picked =
        provider.carriesForcedToolChoice === true
          ? await pickByForcedTool(
              provider,
              options,
              input,
              candidates,
              allowed,
              maxExamples,
              signal,
            )
          : await pickByParse(provider, options, input, candidates, allowed, maxExamples, signal);
      return ids.map((id) => ({ id, score: picked === id ? 1 : 0 }));
    },
  };
}

/** The intent catalog as prompt lines — id, sentence, up to N examples. */
function catalogLines(candidates: readonly IntentCandidate[], maxExamples: number): string {
  return candidates
    .map((c) => {
      const examples = c.examples.slice(0, maxExamples);
      const exampleClause =
        examples.length > 0
          ? `\n  examples: ${examples.map((e) => JSON.stringify(e)).join(' | ')}`
          : '';
      return `- ${c.id}: ${c.intent}${exampleClause}`;
    })
    .join('\n');
}

function systemPromptFor(candidates: readonly IntentCandidate[], maxExamples: number): string {
  return (
    `You classify ONE user message against a fixed list of declared intents.\n` +
    `Intents:\n${catalogLines(candidates, maxExamples)}\n\n` +
    `Pick the single intent id that the message decisively expresses. If none of the ` +
    `declared intents fits, pick '${NONE}'. Never invent an id.`
  );
}

function messagesFor(
  input: IntentScorerInput,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns = (input.recentTurns ?? []).map((t) => ({ role: t.role, content: t.content }));
  return [...turns, { role: 'user' as const, content: input.message }];
}

/** The forced-tool path: the provider constrains generation to the enum. */
async function pickByForcedTool(
  provider: LLMProvider,
  options: LlmClassifierOptions,
  input: IntentScorerInput,
  candidates: readonly IntentCandidate[],
  allowed: readonly string[],
  maxExamples: number,
  signal?: AbortSignal,
): Promise<string> {
  const tool: LLMToolSchema = {
    name: PICK_TOOL,
    description: `Report which declared intent the user's message expresses ('${NONE}' if none).`,
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: [...allowed], description: 'The picked intent id.' },
      },
      required: ['intent'],
      additionalProperties: false,
    },
  };
  const resp = await complete(provider, {
    systemPrompt: systemPromptFor(candidates, maxExamples),
    messages: messagesFor(input),
    tools: [tool],
    toolChoice: { type: 'tool', name: PICK_TOOL },
    model: options.model,
    signal,
  });
  const call = resp.toolCalls.find((tc) => tc.name === PICK_TOOL);
  const picked = (call?.args as { intent?: unknown } | undefined)?.intent;
  // Off-enum = parse failure, never a route.
  return typeof picked === 'string' && allowed.includes(picked) ? picked : NONE;
}

/** The parse path: strict single line, one structured re-ask, then 'none'. */
async function pickByParse(
  provider: LLMProvider,
  options: LlmClassifierOptions,
  input: IntentScorerInput,
  candidates: readonly IntentCandidate[],
  allowed: readonly string[],
  maxExamples: number,
  signal?: AbortSignal,
): Promise<string> {
  const instruction = `Answer with EXACTLY one id from this list and nothing else: ${allowed.join(
    ', ',
  )}`;
  const base = messagesFor(input);
  const first = await complete(provider, {
    systemPrompt: `${systemPromptFor(candidates, maxExamples)}\n\n${instruction}`,
    messages: base,
    model: options.model,
    signal,
  });
  const parsed = parseEnumLine(first.content, allowed);
  if (parsed !== undefined) return parsed;
  const retry = await complete(provider, {
    systemPrompt: `${systemPromptFor(candidates, maxExamples)}\n\n${instruction}`,
    messages: [
      ...base,
      { role: 'assistant', content: first.content },
      {
        role: 'user',
        content:
          `That answer was not one of the allowed ids. Reply with exactly one of: ` +
          `${allowed.join(', ')} — a bare id, no punctuation, no explanation.`,
      },
    ],
    model: options.model,
    signal,
  });
  return parseEnumLine(retry.content, allowed) ?? NONE;
}

/** A trimmed single-token answer that IS one of the allowed ids, else undefined. */
function parseEnumLine(content: string, allowed: readonly string[]): string | undefined {
  const line = content.trim().replace(/^["'`]+|["'`.,]+$/g, '');
  return allowed.includes(line) ? line : undefined;
}

/** One `complete()` with only the fields this classifier uses. */
async function complete(
  provider: LLMProvider,
  req: {
    systemPrompt: string;
    messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
    tools?: readonly LLMToolSchema[];
    toolChoice?: { type: 'tool'; name: string };
    model?: string;
    signal?: AbortSignal;
  },
): Promise<LLMResponse> {
  const request: LLMRequest = {
    systemPrompt: req.systemPrompt,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(req.tools !== undefined && { tools: req.tools }),
    ...(req.toolChoice !== undefined && { toolChoice: req.toolChoice }),
    model: req.model ?? '',
    ...(req.signal !== undefined && { signal: req.signal }),
  };
  return provider.complete(request);
}
