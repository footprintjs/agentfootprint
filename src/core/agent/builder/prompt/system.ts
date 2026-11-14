import type { CachePolicy } from '../../../../cache/types.js';

export interface PromptPort {
  systemPromptSet: boolean;
  systemPromptValue: string;
  systemPromptCachePolicy: CachePolicy;
  systemPromptCacheExplicit: boolean;
}

export function setSystem(
  self: PromptPort,
  prompt: string,
  options: { readonly cache?: CachePolicy } | undefined,
  original: object,
): object {
  if (self.systemPromptSet) {
    throw new Error(
      'AgentBuilder.system: already set. Each agent has one base system prompt — a second ' +
        'call used to REPLACE the first silently, so the instructions you wrote first were ' +
        'never sent and nothing said so. For a second block of always-on system content, ' +
        'add it as an injection: .steering(defineSteering({ id, content })) composes into ' +
        'the same slot, is visible in the trace as its own entry, and can be cached ' +
        'separately. To decide the prompt PER RUN, use .configure(({ defaults }) => ' +
        '({ instructions: … })). To build one string from parts, join them yourself and ' +
        'pass the result once.',
    );
  }
  self.systemPromptSet = true;
  self.systemPromptValue = prompt;
  if (options?.cache !== undefined) {
    self.systemPromptCachePolicy = options.cache;
    self.systemPromptCacheExplicit = true;
  }
  return original;
}
