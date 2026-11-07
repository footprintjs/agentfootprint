import {
  forcedToolChoiceFor,
  UnsupportedToolChoiceError,
} from '../../../provider-contract/forcedToolChoice.js';
import {
  nativeOutputSchemaFor,
  UnsupportedNativeOutputError,
} from '../../../provider-contract/nativeOutputSchema.js';
import type { LLMProvider } from '../../../provider-contract/types.js';
import type { ReliabilityConfig } from '../../../reliability/types.js';
import type { ResolvedOutputEnforcement } from '../outputEnforcement.js';

/** What the run-start check reads: the first provider a run would actually call. */
export interface OutputStrategyTarget {
  readonly enforcement: ResolvedOutputEnforcement | undefined;
  readonly provider: LLMProvider;
  readonly model: string;
  readonly providers: ReliabilityConfig['providers'];
  /** A configured agent resolves its model at seed; `callLLM` judges that final model. */
  readonly modelResolvedAtSeed: boolean;
}

/**
 * Refuse, at run start, an output strategy the provider cannot carry.
 *
 * Run start rather than build time: a decorated provider (`withFallback`,
 * `withRetry`, a breaker) is only the thing it is once composed, and
 * `withFallback` publishes the AND of its pair.
 *
 * A refusal rather than a quiet fall back to `'instruct'`, because the two are
 * not interchangeable: `'tool-forced'` and `'native'` constrain the shape at
 * generation and decoding, `'instruct'` asks for it in prose. An agent that
 * silently got the second while its config said the first would be a promise
 * the recording could not even show was broken.
 */
export function assertOutputStrategySupported(target: OutputStrategyTarget): void {
  assertForcedToolChoiceSupported(target);
  assertNativeOutputSchemaSupported(target);
}

function assertForcedToolChoiceSupported(target: OutputStrategyTarget): void {
  if (target.enforcement?.schemaTool === undefined) return;
  const first = target.providers?.[0];
  const provider = first?.provider ?? target.provider;
  const model = first?.model ?? target.model;
  if (provider.carriesForcedToolChoice === true) {
    if ((first === undefined && target.modelResolvedAtSeed) || forcedToolChoiceFor(provider, model))
      return;
    throw new UnsupportedToolChoiceError({ provider: provider.name, model });
  }
  throw new Error(
    `Agent: .outputSchema(parser, { strategy: 'tool-forced' }) needs a provider that puts ` +
      `a forced tool choice on its wire, and '${provider.name}' does not declare one. ` +
      `Anthropic, Bedrock, real OpenAI/Azure and the mock do; an OpenAI-COMPATIBLE endpoint ` +
      `behind a custom baseURL (Ollama, vLLM, …) deliberately does not, because what that ` +
      `server does with tool_choice is not this library's to promise. Use ` +
      `{ strategy: 'instruct', retries: N } on this provider — it works on every wire — or ` +
      `run the forced strategy on a provider that declares the capability.`,
  );
}

function assertNativeOutputSchemaSupported(target: OutputStrategyTarget): void {
  const { enforcement } = target;
  if (enforcement?.outputFormat === undefined || enforcement.nativeOutputAuto === true) return;
  const first = target.providers?.[0];
  const provider = first?.provider ?? target.provider;
  const model = first?.model ?? target.model;
  if (provider.carriesNativeOutputSchema === true) {
    if (
      (first === undefined && target.modelResolvedAtSeed) ||
      nativeOutputSchemaFor(provider, model)
    )
      return;
    throw new UnsupportedNativeOutputError({ provider: provider.name, model });
  }
  throw new Error(
    `Agent: .outputSchema(parser, { strategy: 'native' }) needs a provider that puts a ` +
      `structured-output format on its wire, and '${provider.name}' does not declare one. ` +
      `anthropic(), browserAnthropic() and the mock do; the Bedrock and gateway adapters do ` +
      `not in this release. Use { strategy: 'instruct', retries: N } on this provider — it ` +
      `works on every wire — or run the native strategy on a provider that declares it.`,
  );
}
