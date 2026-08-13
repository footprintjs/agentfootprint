/**
 * 60 — The Gemini tool loop that gives the signature back.
 *
 * Four things a live Google Cloud field trial taught this library, in one
 * runnable file. Nothing here reaches Google: the trial's exact wire shapes are
 * replayed through `gemini({ _client })`, the structural double the adapter
 * takes for testing, so you can run this offline and watch the fix work.
 *
 *  1. **The thought signature comes back.** A current Gemini model signs the
 *     reasoning behind a function call and REFUSES the next turn without that
 *     signature — HTTP 400, *after your tool has already run*. The adapter now
 *     carries it on `toolCalls[].providerMeta` and writes it back onto the
 *     function-call part of the next request, byte for byte.
 *
 *  2. **The model default is per DOOR.** `gemini({ project })` (Vertex) resolves
 *     the `'gemini'` shorthand to a model the trial ran end to end.
 *     `gemini({ apiKey })` (AI Studio) resolves it to a teaching refusal,
 *     because the model this package used to send answers 404 there for a new
 *     account — and no other model could be proven on that door.
 *
 *  3. **Thinking tokens are visible.** `usage.thinking` now reaches
 *     `agentfootprint.stream.llm_end`. It is NOT inside `output`, so a cost
 *     estimate built from `input + output` under-counts a thinking model by
 *     whatever it thought.
 *
 *  4. **`apiKey` can be a callback.** For a credential that expires — a Vertex
 *     OAuth token lives about an hour — pass a function and it is re-read
 *     before every request.
 *
 * Run it:
 *   npm run example examples/features/60-gemini-field-truths.ts
 */

import { Agent, defineTool } from '../../src/index.js';
import { gemini } from '../../src/adapters/llm/GeminiProvider.js';
import type {
  GeminiClientLike,
  GeminiGenerateParams,
} from '../../src/adapters/llm/GeminiProvider.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/60-gemini-field-truths',
  title: 'Gemini gives the signature back',
  group: 'features',
  description:
    "A Gemini tool loop that echoes the model's thought signature (without it, the second call is a 400 after your tool already ran), plus per-door model defaults, visible thinking tokens, and a refreshable apiKey.",
  defaultInput: 'what is the validation code for vertex-alpha?',
  providerSlots: ['default'],
  tags: ['feature', 'gemini', 'google', 'vertex', 'tool-calling', 'thinking', 'credentials'],
};

/** The signature shape the trial's model attached to its function call. */
const SIGNATURE = 'Cs4BAdHtim9maWVsZC10cmlhbC1zaWduYXR1cmU=';

/**
 * A stand-in for `@google/genai`, scripted with the trial's two turns.
 *
 * Turn 1 asks for the tool AND signs it. Turn 2 answers — and, being the
 * turn the live service rejected, it ASSERTS that the signature came back.
 * That assertion is the whole point of the example: delete the round trip and
 * this double fails exactly where Google did.
 */
function scriptedGemini(seen: GeminiGenerateParams[]): GeminiClientLike {
  let turn = 0;
  const answer = () => {
    turn += 1;
    if (turn === 1) {
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  thoughtSignature: SIGNATURE,
                  functionCall: { name: 'trial_lookup', args: { record: 'vertex-alpha' } },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        // The trial's own numbers: 243 tokens spent thinking, in neither
        // `input` nor `output`.
        usageMetadata: { promptTokenCount: 21, candidatesTokenCount: 9, thoughtsTokenCount: 243 },
      };
    }
    return {
      candidates: [
        {
          content: { parts: [{ text: 'The validation code for vertex-alpha is VERTEX-AF-9137.' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 154, candidatesTokenCount: 30 },
    };
  };

  /** What Google actually enforces, reproduced. */
  const requireSignature = (params: GeminiGenerateParams): void => {
    const call = params.contents.flatMap((c) => c.parts).find((p) => p.functionCall !== undefined);
    if (call && call.thoughtSignature !== SIGNATURE) {
      throw Object.assign(
        new Error(
          'Function call is missing a thought_signature in functionCall parts. This is required ' +
            'for tools to work correctly.',
        ),
        { status: 400 },
      );
    }
  };

  return {
    models: {
      async generateContent(params) {
        seen.push(params);
        requireSignature(params);
        return answer();
      },
      async generateContentStream(params) {
        seen.push(params);
        requireSignature(params);
        const scripted = answer();
        return (async function* () {
          yield scripted;
        })();
      },
    },
  };
}

const trialLookup = defineTool<{ record: string }, string>({
  name: 'trial_lookup',
  description: 'Look up the validation code for a trial record',
  inputSchema: {
    type: 'object',
    properties: { record: { type: 'string' } },
    required: ['record'],
  },
  execute: () => 'VERTEX-AF-9137',
});

export async function run(input: string): Promise<unknown> {
  const seen: GeminiGenerateParams[] = [];

  // #region provider
  // The VERTEX door. `model: 'gemini'` is the shorthand, and on this door it
  // resolves to the model the field trial ran end to end.
  const provider = gemini({
    project: 'my-project',
    location: 'global',
    // A CALLBACK, not a string: re-read before every request, which is how a
    // one-hour Vertex OAuth token refreshes without rebuilding the provider.
    // (Vertex ADC does this for you; this shape is for the doors that don't.)
    apiKey: async () => Promise.resolve(await currentToken()),
    _client: scriptedGemini(seen), // ← drop this line to talk to the real thing
  });
  // #endregion provider

  const agent = Agent.create({ provider, model: 'gemini' }).tool(trialLookup).build();

  // #region thinking
  // The thinking tokens now reach the event, so a short answer is explainable
  // instead of mysterious. They are NOT part of `output`.
  agent.on('agentfootprint.stream.llm_end', (event) => {
    const { input: inTok, output, thinking } = event.payload.usage;
    console.log(
      `  llm_end  input=${inTok} output=${output}` +
        (thinking === undefined
          ? ''
          : ` thinking=${thinking}  ← billed, and in neither of the others`),
    );
  });
  // #endregion thinking

  const answer = await agent.run({ message: input });

  // #region signature
  // The proof: on the SECOND request the assistant's function-call part carries
  // the signature the model signed it with. The scripted client refuses the
  // turn without it — exactly as the live service did, after the tool had run.
  const secondRequest = seen[seen.length - 1]!;
  const signedPart = secondRequest.contents
    .flatMap((c) => c.parts)
    .find((p) => p.functionCall?.name === 'trial_lookup');
  console.log(`  signature echoed: ${signedPart?.thoughtSignature === SIGNATURE ? 'yes' : 'NO'}`);
  // #endregion signature

  return answer;
}

/** Stands in for a real token fetch (metadata server, secret manager, STS). */
async function currentToken(): Promise<string> {
  return 'ya29.a-short-lived-token';
}

// ── The other door, and the refusal it gives instead of a 404 ─────────

export async function keyDoorRefusal(): Promise<string> {
  // #region doors
  const provider = gemini({
    apiKey: 'AIza-your-ai-studio-key',
    _client: scriptedGemini([]),
    // No `defaultModel`. On THIS door the 'gemini' shorthand has nothing to
    // resolve to — pass `defaultModel: 'the-model-your-key-can-use'`, or name
    // the model per call.
  });
  // #endregion doors
  try {
    await provider.complete({ model: 'gemini', messages: [{ role: 'user', content: 'hi' }] });
    return '(no refusal — unexpected)';
  } catch (err) {
    return (err as Error).message;
  }
}

if (isCliEntry(import.meta.url)) {
  (async () => {
    console.log('— Vertex door, one tool loop —');
    const answer = await run(meta.defaultInput ?? '');
    console.log('\n— Key door, same shorthand —');
    console.log(`  ${(await keyDoorRefusal()).split('\n')[0]}`);
    printResult(answer);
  })().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
