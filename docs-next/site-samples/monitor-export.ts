import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build();
declare const tracer: Parameters<typeof otelObservability>[0]['tracer'];

// #region code
import { otelObservability, xrayObservability } from 'agentfootprint/observe';
import { setImmediateDriver } from 'footprintjs/detach';

// Native: typed events, as the agent runs.
agent.on('agentfootprint.stream.tool_end', (event) => console.log(event.payload));

// Any OTLP backend, through your own OpenTelemetry tracer.
agent.enable.observability({
  strategy: otelObservability({ serviceName: 'refunds', tracer }),
  // @ts-expect-error This repo holds two copies of footprintjs. A reader's project holds one.
  detach: { driver: setImmediateDriver, mode: 'forget' }, // off the agent's call path
});

// Or straight to AWS X-Ray.
agent.enable.observability({ strategy: xrayObservability({ region: 'us-west-2', serviceName: 'refunds' }) });
// #endregion code
