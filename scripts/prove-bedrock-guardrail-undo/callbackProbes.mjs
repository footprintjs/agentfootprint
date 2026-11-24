/** Completed-result callback boundaries; the existing guarded driver owns execution. */
export function callbackProbes({ assertion, callbackTests }) {
  return [
    {
      id: 'retry-complete-callback-undo',
      purpose: 'Let a recovery callback replace the completed terminal response on complete.',
      source: 'src/resilience/withRetry.ts',
      before: '          reportRecovered(hooks, attempt, startedMs, res);',
      after: '          reportRecovered(hooks, attempt, startedMs);',
      assertions: [
        assertion(
          callbackTests,
          'complete: completed intervention recovery callback',
          'blocked with throwing recovered hook',
          'failed',
          'to be an instance of',
        ),
        assertion(
          callbackTests,
          'complete: completed intervention recovery callback',
          'masked with throwing recovered hook',
          'passed',
        ),
      ],
    },
    {
      id: 'retry-stream-callback-undo',
      purpose: 'Let a startup recovery callback replace the captured terminal stream response.',
      source: 'src/resilience/withRetry.ts',
      before: '          reportRecovered(hooks, attempt, startedMs, response);',
      after: '          reportRecovered(hooks, attempt, startedMs);',
      assertions: [
        assertion(
          callbackTests,
          'stream: completed intervention recovery callback',
          'blocked with throwing recovered hook',
          'failed',
          'to be an instance of',
        ),
        assertion(
          callbackTests,
          'stream: completed intervention recovery callback',
          'masked with throwing recovered hook',
          'passed',
        ),
      ],
    },
    {
      id: 'breaker-complete-callback-undo',
      purpose: 'Drop completed intervention evidence from the breaker success notification.',
      source: 'src/resilience/withCircuitBreaker.ts',
      before: '        recordSuccess(hooks, res);',
      after: '        recordSuccess(hooks);',
      assertions: [
        assertion(
          callbackTests,
          'complete: completed intervention breaker callback inside fallback',
          'blocked with throwing state hook',
          'failed',
          'to be an instance of',
        ),
        assertion(
          callbackTests,
          'complete: completed intervention breaker callback inside fallback',
          'masked with throwing state hook',
          'passed',
        ),
      ],
    },
    {
      id: 'breaker-stream-callback-undo',
      purpose: 'Drop the terminal stream response before the breaker closing callback.',
      source: 'src/resilience/withCircuitBreaker.ts',
      before: '          recordSuccess(hooks, completedResponse);',
      after: '          recordSuccess(hooks);',
      assertions: [
        assertion(
          callbackTests,
          'stream: completed intervention breaker callback inside fallback',
          'blocked with throwing state hook',
          'failed',
          'to be an instance of',
        ),
        assertion(
          callbackTests,
          'stream: completed intervention breaker callback inside fallback',
          'masked with throwing state hook',
          'passed',
        ),
      ],
    },
    {
      id: 'recovery-response-accessor-undo',
      purpose: 'Read the foreign response getter again during recovery notification.',
      source: 'src/resilience/withRetry.ts',
      before:
        "              response = Object.getOwnPropertyDescriptor(first.value, 'response')?.value;",
      after: '              response = first.value.response;',
      assertions: [
        assertion(
          callbackTests,
          'ordinary stream callback controls',
          'ordinary first chunk reads its response slot once (recovered)',
          'failed',
          '(response slot read twice|called once|to be called)',
        ),
        assertion(
          callbackTests,
          'ordinary stream callback controls',
          'ordinary first chunk reads its response slot once (first attempt)',
          'passed',
        ),
      ],
    },
    {
      id: 'recovery-optional-reflection-undo',
      purpose: 'Let optional response-descriptor reflection create an ordinary stream failure.',
      source: 'src/resilience/withRetry.ts',
      before: `            try {
              response = Object.getOwnPropertyDescriptor(first.value, 'response')?.value;
            } catch {
              // Optional terminal evidence must not change an ordinary stream's behavior.
            }`,
      after:
        "            response = Object.getOwnPropertyDescriptor(first.value, 'response')?.value;",
      assertions: [
        {
          file: callbackTests,
          fullName: 'ordinary recovered stream ignores an unavailable response descriptor',
          status: 'failed',
          failurePattern: 'called once',
        },
        assertion(
          callbackTests,
          'stream: completed intervention recovery callback',
          'masked with nonthrowing recovered hook',
          'passed',
        ),
      ],
    },
    {
      id: 'breaker-first-terminal-undo',
      purpose: 'Let a malformed later response replace the first captured terminal outcome.',
      source: 'src/resilience/withCircuitBreaker.ts',
      before: '            if (captured !== chunk) completedResponse ??= captured.response;',
      after: '            if (captured !== chunk) completedResponse = captured.response;',
      assertions: [
        {
          file: callbackTests,
          fullName: 'breaker stream callback retains its first captured terminal response',
          status: 'failed',
          failurePattern: 'to be an instance of',
        },
        assertion(
          callbackTests,
          'stream: completed intervention breaker callback inside fallback',
          'masked with nonthrowing state hook',
          'passed',
        ),
      ],
    },
    {
      id: 'recovery-iterator-result-undo',
      purpose: 'Re-expose a foreign yielded-step value getter to the recovery and yield readers.',
      source: 'src/resilience/replayAttempt.ts',
      before: '    return { done: false, value };',
      after: '    return value === original ? item : { done: false, value };',
      assertions: [
        {
          file: callbackTests,
          fullName: 'ordinary recovered stream snapshots a foreign iterator value once',
          status: 'failed',
          failurePattern: 'extra iterator value read',
        },
        assertion(
          callbackTests,
          'stream: completed intervention recovery callback',
          'masked with nonthrowing recovered hook',
          'passed',
        ),
      ],
    },
  ];
}
