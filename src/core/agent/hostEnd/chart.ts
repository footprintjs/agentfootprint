import { flowChart, type FlowChartBuilder } from 'footprintjs';
import type { AgentChartDeps } from '../chartContract.js';

/** Return to the native terminal owner before publishing an admitted candidate. */
export function mountHostTurn(builder: FlowChartBuilder, deps: AgentChartDeps): FlowChartBuilder {
  if (!deps.chooseHostTurn) return builder;
  const admitted = flowChart<string>(
    'Finish host admission',
    (scope) => {
      scope.$break('Host admission complete');
      return '';
    },
    'host-admitted',
  ).build();
  return builder
    .addDeciderFunction('Who supplies this reply?', deps.chooseHostTurn, 'turn-author')
    .addSubFlowChartBranch('host', admitted, 'Host', { propagateBreak: true })
    .addFunctionBranch('model', 'Continue agent turn', () => undefined)
    .setDefault('model')
    .end();
}
