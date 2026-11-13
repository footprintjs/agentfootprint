import type { AgentfootprintEvent } from '../../../events/registry.js';
import { rateLimitedConsoleSink } from '../deliveryErrors.js';
import type {
  OtelObservabilityOptions,
  OtelObservabilityStrategy,
  OtelDecisionEvidenceRecorder,
} from './types.js';
import { DEFAULT_MAX_CONTENT_CHARS } from './attributes/projections.js';
import { createSpanWriter } from './spans/writer.js';
import { createTurnStore } from './turns/state.js';
import { createToolContent } from './content/tools.js';
import { createExplainability } from './events/explainability.js';
import { createLateEvents } from './events/late.js';
import { createEventDispatcher } from './events/dispatch.js';
import { decisionEvidenceRecorder } from './events/decisions.js';

export function createOtelStrategy(opts: OtelObservabilityOptions): OtelObservabilityStrategy {
  if (!opts.serviceName) {
    throw new TypeError(
      `[otelObservability] \`serviceName\` is required. ` +
        `Pass an identifier visible in your OTel backend's service map, e.g. 'my-agent-prod'.`,
    );
  }

  const sampleRate = opts.sampleRate ?? 1;
  const genAiNames = opts.genAiSpanNames === true;
  const explainability = opts.explainability !== false;
  const scopeName = opts.scopeName ?? 'agentfootprint';
  const captureContent = opts.captureContent === true;
  const captureToolContent = opts.captureToolContent === true;
  const maxContentChars = opts.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const rawConversationId = opts.conversationId === 'raw';
  const allCheckRows = opts.checkAccounting === 'all';

  const spans = createSpanWriter(opts, scopeName);
  const turns = createTurnStore();
  const { activeTurns, closedTurns, forgottenRuns, soleActiveTurn } = turns;
  const { popSpan, endSpan, topSpan, recordSpanEvent } = spans;
  const lifecycle = { stopped: false };
  // The fallback when the consumer wires nothing. Rate-limited; a
  // consumer-supplied sink is not. Armed at CONSTRUCTION — before 8.11.0 it
  // was installed lazily inside `_onError` itself, which meant any caller
  // reading the hook rather than calling the method found `undefined`.
  const consoleSink = rateLimitedConsoleSink('otel');

  /** A failure this adapter must not swallow — through the strategy's own
   *  `_onError`, so a hook assigned after construction is the one called. */
  function report(error: Error, event?: AgentfootprintEvent): void {
    try {
      strategy._onError?.(error, event);
    } catch {
      /* a failing sink must never break the agent loop */
    }
  }

  const content = createToolContent(maxContentChars, turns.codeRunners);
  const explanation = createExplainability(captureContent, explainability, turns.ranTools, spans);
  const { flushStandings } = explanation;
  const late = createLateEvents({
    opts,
    captureContent,
    maxContentChars,
    allCheckRows,
    turns,
    spans,
    report,
  });
  const handleEvent = createEventDispatcher({
    opts,
    sampleRate,
    genAiNames,
    explainability,
    captureContent,
    captureToolContent,
    maxContentChars,
    rawConversationId,
    lifecycle,
    turns,
    spans,
    content,
    explanation,
    late,
  });
  const strategy: OtelObservabilityStrategy = {
    name: 'otel',
    capabilities: { events: true, traces: true },
    exportEvent: handleEvent,
    flush(): void {
      // OTel SDKs handle their own flushing (the consumer-configured
      // SpanProcessor's `forceFlush()`). We don't cross that boundary
      // here — calling `provider.forceFlush()` is the consumer's
      // responsibility on shutdown. Documented in the README.
    },
    stop(): void {
      lifecycle.stopped = true;
      // Defensive: end any spans the agent loop didn't close.
      for (const [, t] of activeTurns) {
        flushStandings(t);
        while (t.stack.length > 0) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        t.toolSpans.clear();
      }
      activeTurns.clear();
      closedTurns.clear();
      forgottenRuns.clear();
    },
    /**
     * Where errors go. Overriding it works — assign `_onError`, or pass
     * `onError` in the factory options.
     */
    _onError(err: Error, event?: AgentfootprintEvent): void {
      (opts.onError ?? consoleSink)(err, event);
    },

    decisionEvidenceRecorder(): OtelDecisionEvidenceRecorder {
      return decisionEvidenceRecorder({
        lifecycle,
        explainability,
        soleActiveTurn,
        topSpan,
        recordSpanEvent,
      });
    },
  };
  return strategy;
}
