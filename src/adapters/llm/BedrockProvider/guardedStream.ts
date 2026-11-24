/** Configured guarded streaming: hold until post-stop metadata and natural completion. */
import type { LLMChunk, LLMRequest, LLMResponse } from '../../../provider-contract/types.js';
import type { ProviderIntervention } from '../../../provider-contract/intervention.js';
import { abortableIterable, throwIfAborted } from '../../../lib/abort.js';
import type { GuardrailConfiguration } from './guardrailConfig.js';
import type { BedrockStreamEvent } from './types.js';
import { classifyGuardrail, unknownGuardrail } from './guardrailClassify.js';
import { ownData } from './guardrailRead.js';
import {
  guardrailUsage,
  presentIntervention,
  terminalGuardrailResponse,
} from './guardrailResponse.js';
import { GuardedStreamBuffer } from './guardedStreamBuffer.js';
import { ensureHonestToolUse, normalizeStopReason } from './response.js';
import { wrapError } from './client.js';

/** Exception members in AWS ConverseStreamOutput are failures, not metadata.
 * https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStreamOutput.html
 * Inspect their presence through own descriptors; do not read service prose.
 */
const STREAM_EXCEPTIONS = [
  ['modelStreamErrorException', 424],
  ['internalServerException', 500],
  ['serviceUnavailableException', 503],
  ['throttlingException', 429],
  ['validationException', 400],
] as const;

function throwStreamException(event: unknown): void {
  for (const [exception, status] of STREAM_EXCEPTIONS) {
    const field = ownData(event, exception);
    if (!field.present) continue;
    throw Object.assign(
      new Error('The Bedrock stream reported a service exception.', {
        cause: field.valid ? field.value : undefined,
      }),
      { name: 'BedrockProviderError', code: 'BEDROCK_STREAM_EXCEPTION', exception, status },
    );
  }
}

/** Missing a stream is an incomplete response, never permission for another SDK call. */
export function missingGuardedStream(config: GuardrailConfiguration): LLMResponse {
  return terminalGuardrailResponse(
    presentIntervention(unknownGuardrail('bedrock_stream_missing'), config),
  );
}

export async function* streamGuardedBedrock(
  stream: AsyncIterable<BedrockStreamEvent>,
  req: LLMRequest,
  config: GuardrailConfiguration,
): AsyncIterable<LLMChunk> {
  const held = new GuardedStreamBuffer(config.maxBufferedBytes);
  let stopReason: string | undefined;
  let stopped = false;
  let metadataAfterStop = false;
  let valid = true;
  let intervention: ProviderIntervention | undefined;
  let usage: LLMResponse['usage'] = { input: 0, output: 0 };
  try {
    for await (const event of abortableIterable(stream, req.signal)) {
      // Even after valid assessment metadata, a later SDK exception prevents
      // natural success. Held content has not been released on this path.
      throwStreamException(event);
      const start = ownData(event, 'contentBlockStart');
      const delta = ownData(event, 'contentBlockDelta');
      const stop = ownData(event, 'contentBlockStop');
      const terminal = ownData(event, 'messageStop');
      const metadata = ownData(event, 'metadata');
      if (!start.valid || !delta.valid || !stop.valid || !terminal.valid || !metadata.valid)
        valid = false;
      if (start.present || delta.present || stop.present) {
        if (stopped) valid = false;
        if (start.valid && start.present) held.acceptStart(start.value);
        if (delta.valid && delta.present) held.acceptDelta(delta.value);
        if (stop.valid && stop.present) held.acceptStop(stop.value);
      }
      if (terminal.present) {
        if (stopped || !terminal.valid) valid = false;
        const reason = ownData(terminal.value, 'stopReason');
        if (!reason.valid || typeof reason.value !== 'string' || reason.value.length === 0)
          valid = false;
        else stopReason = reason.value;
        stopped = true;
      }
      if (metadata.present) {
        const value = metadata.value;
        if (
          !metadata.valid ||
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value)
        ) {
          valid = false;
          continue;
        }
        const counts = ownData(value, 'usage');
        if (!counts.valid) valid = false;
        if (counts.present && counts.valid) usage = guardrailUsage(counts.value);
        const trace = ownData(value, 'trace');
        if (!trace.valid) valid = false;
        // Early usage alone is permitted, but assessment outside the admitted
        // sequence cannot be discarded and replaced by later usable metadata.
        if (!stopped) {
          if (trace.present) valid = false;
          continue;
        }
        if (metadataAfterStop) valid = false;
        metadataAfterStop = true;
        const envelope = {
          stopReason,
          ...(trace.present && trace.valid ? { trace: trace.value } : {}),
        };
        intervention = classifyGuardrail(envelope, config);
      }
    }
    // Natural completion is the last admission input. No elapsed-time guess
    // or callback turns a still-open SDK iterator into a completed response.
    throwIfAborted(req.signal);
    if (
      !valid ||
      !stopped ||
      !metadataAfterStop ||
      (!held.hasCompleteContent() && intervention?.outcome !== 'blocked')
    ) {
      intervention = unknownGuardrail(stopReason ?? 'bedrock_stream_incomplete');
    }
    if (intervention !== undefined) intervention = presentIntervention(intervention, config);
    if (intervention !== undefined && intervention.outcome !== 'masked') {
      yield {
        tokenIndex: 0,
        content: '',
        done: true,
        response: terminalGuardrailResponse(intervention, usage),
      };
      return;
    }
    // Only admitted usable content reaches ordinary argument parsing. A
    // malformed tool beside a block/unknown never creates a retryable parse failure.
    const response = ensureHonestToolUse({
      content: held.content(),
      toolCalls: held.toolCalls(),
      usage,
      stopReason: normalizeStopReason(stopReason ?? 'end_turn'),
      ...(intervention === undefined ? {} : { intervention }),
    });
    let tokenIndex = 0;
    for (const content of held.chunks()) yield { tokenIndex: tokenIndex++, content, done: false };
    yield { tokenIndex, content: '', done: true, response };
  } catch (error) {
    throw wrapError(error, req.signal);
  }
}
