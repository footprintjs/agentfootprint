/** Second source-review undo cases; the existing driver owns execution and validation. */
export function reviewProbes({
  assertion,
  wrapperTests,
  llmAccountingTests,
  directTests,
  hostIdentityTests,
  guardedStream,
  sequenceTests,
}) {
  return [
    {
      id: 'response-decoration-capture-undo',
      purpose: 'Decorate an uncaptured terminal response before fallback admission.',
      source: 'src/resilience/withFallback.ts',
      before: `    const captured = captureProviderResponse(res);
    return tagsThinking ? tagThinkingResponse(captured, side) : captured;`,
      after: '    return tagsThinking ? tagThinkingResponse(res, side) : res;',
      assertions: [
        assertion(
          wrapperTests,
          'complete: wrapper response admission',
          'fallback different thinking preserves blocked without reading rawThinking',
          'failed',
          'not be called at all',
        ),
        assertion(
          wrapperTests,
          'complete: wrapper response admission',
          'fallback different thinking keeps masked thinking and replay reports',
          'passed',
        ),
      ],
    },
    {
      id: 'terminal-chunk-capture-undo',
      purpose: 'Bypass the one terminal chunk projection before wrapper decoration.',
      source: 'src/provider-contract/responseAdmission.ts',
      before: 'export function captureProviderChunk(chunk: LLMChunk): LLMChunk {\n',
      after:
        'export function captureProviderChunk(chunk: LLMChunk): LLMChunk {\n  return chunk; // Undo terminal chunk admission.\n',
      assertions: [
        assertion(
          wrapperTests,
          'stream: captured terminal chunk',
          'fallback different thinking preserves blocked without rereading response',
          'failed',
          'to be called 1 times',
        ),
        assertion(
          wrapperTests,
          'stream: wrapper response admission',
          'fallback different thinking keeps masked thinking and replay reports',
          'passed',
        ),
      ],
    },
    {
      id: 'llm-accounting-capture-undo',
      purpose: 'Restore foreign response reads before direct native completion accounting.',
      source: 'src/core/LLMCall/chart.ts',
      before: '    const response = captureProviderResponse(\n',
      after: '    const response = ((value) => value)(\n',
      assertions: [
        assertion(
          llmAccountingTests,
          'LLMCall terminal accounting uses the captured response',
          'blocked: listeners and pricing cannot re-read foreign response fields',
          'failed',
          'not be called at all',
        ),
        assertion(
          llmAccountingTests,
          'LLMCall terminal accounting uses the captured response',
          'ordinary: keeps normal completion, pricing, and answer recording',
          'passed',
        ),
      ],
    },
    {
      id: 'withheld-completion-marker-undo',
      purpose: 'Report the native merge terminal completion without its withheld marker.',
      source: 'src/core-flow/Parallel/merge.ts',
      before: '  requireUsableProviderResponse(scope, response, () => notifyCompleted(true));',
      after: '  requireUsableProviderResponse(scope, response, notifyCompleted);',
      assertions: [
        assertion(
          directTests,
          'every direct native model caller admits provider intervention',
          'parallel merge: blocked',
          'failed',
          'expected undefined to be true',
        ),
        assertion(
          directTests,
          'every direct native model caller admits provider intervention',
          'parallel merge: ordinary',
          'passed',
        ),
      ],
    },
    {
      id: 'host-refusal-identity-undo',
      purpose: 'Promote a provider-code spelling before considering typed failure evidence.',
      source: 'src/hosting/protocolRoute.ts',
      before: '            settlement?.refusal ??',
      after: '            hostRefusalCode(code) ?? settlement?.refusal ??',
      assertions: [
        assertion(
          hostIdentityTests,
          'standing provider refusal identity',
          'a standalone string-only framing failure cannot prove ERR_PROVIDER_BLOCKED',
          'failed',
          'to deeply equal',
        ),
        assertion(
          hostIdentityTests,
          'standing provider refusal identity',
          'throw: actual ProviderBlockedError keeps its proved refusal',
          'passed',
        ),
      ],
    },
    {
      id: 'early-assessment-sequence-undo',
      purpose:
        'Discard an early assessment while allowing later usage metadata to authorize release.',
      source: guardedStream,
      before: '          if (trace.present) valid = false;',
      after: '          // Undo: discard early assessment evidence.',
      assertions: [false, true].flatMap((classDoor) => [
        assertion(
          sequenceTests,
          'guarded stream trace ordering',
          `class=${classDoor}, later=usage only: early blocked cannot authorize release`,
          'failed',
          "expected undefined to be 'unknown'",
        ),
        assertion(
          sequenceTests,
          'guarded stream trace ordering',
          `class=${classDoor}: early usage alone preserves ordered masked`,
          'passed',
        ),
      ]),
    },
  ];
}
