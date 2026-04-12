/**
 * Sample 15: Error Handling
 *
 * LLMError, classification, wrapSDKError — structured error management.
 */
import { LLMError } from 'agentfootprint';
import { classifyStatusCode, wrapSDKError } from 'agentfootprint/resilience';

export async function run(_input: string) {
  const classifications = {
    '401': classifyStatusCode(401),
    '429': classifyStatusCode(429),
    '500': classifyStatusCode(500),
    '413': classifyStatusCode(413),
  };

  const rateLimitError = new LLMError({ message: 'Too many requests', code: 'rate_limit', provider: 'openai', statusCode: 429 });
  const authError = new LLMError({ message: 'Invalid API key', code: 'auth', provider: 'anthropic', statusCode: 401 });

  const sdkError = new Error('fetch failed: ECONNREFUSED');
  const wrapped = wrapSDKError(sdkError, 'openai');

  return {
    classifications,
    rateLimitError: { code: rateLimitError.code, retryable: rateLimitError.retryable },
    authError: { code: authError.code, retryable: authError.retryable },
    wrappedNetworkError: { code: wrapped.code, retryable: wrapped.retryable },
  };
}

if (process.argv[1] === import.meta.filename) {
  run('').then(console.log);
}
