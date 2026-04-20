/**
 * LLMError taxonomy — classifyStatusCode, wrapSDKError, and the retryable
 * flag. Uniform error handling across all providers.
 */

import { LLMError } from 'agentfootprint';
import { classifyStatusCode, wrapSDKError } from 'agentfootprint/resilience';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'integrations/02-error-handling',
  title: 'LLMError taxonomy + classification',
  group: 'integrations',
  description: 'Uniform error codes, classifyStatusCode, wrapSDKError, retryable flag.',
  defaultInput: '',
  providerSlots: [],
  tags: ['integration', 'errors', 'LLMError'],
};

export async function run(_input: string, _provider?: LLMProvider) {
  const classifications = {
    '401': classifyStatusCode(401),
    '429': classifyStatusCode(429),
    '500': classifyStatusCode(500),
    '413': classifyStatusCode(413),
  };

  const rateLimitError = new LLMError({
    message: 'Too many requests',
    code: 'rate_limit',
    provider: 'openai',
    statusCode: 429,
  });
  const authError = new LLMError({
    message: 'Invalid API key',
    code: 'auth',
    provider: 'anthropic',
    statusCode: 401,
  });

  const sdkError = new Error('fetch failed: ECONNREFUSED');
  const wrapped = wrapSDKError(sdkError, 'openai');

  return {
    classifications,
    rateLimitError: { code: rateLimitError.code, retryable: rateLimitError.retryable },
    authError: { code: authError.code, retryable: authError.retryable },
    wrappedNetworkError: { code: wrapped.code, retryable: wrapped.retryable },
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
