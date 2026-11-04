/** Actual native admission without a domain serving declaration, for fail-closed tests. */
import { flowChart, type RedactionPolicy } from 'footprintjs';
import { Agent } from '../../src/core/Agent.js';
import { RunnerBase } from '../../src/core/RunnerBase.js';
import { declareRedaction } from '../../src/redaction/declared.js';

export class UnknownRun extends RunnerBase<string, string> {
  constructor(secret: string, policy?: RedactionPolicy) {
    super();
    declareRedaction(this, policy);
    this.initChart(
      () =>
        flowChart(
          'Unregistered',
          (scope) => {
            scope.$setValue('payload', secret);
          },
          'unregistered',
        ).build(),
      {
        runnerId: 'unknown-fixture',
        compositionPath: [],
        initialize: () => ({}),
      },
    );
  }

  async run(input: string): Promise<string> {
    return this.runExecution().withRun(async (invocation) => {
      // Deliberately omit prepareRunRedaction; no record may infer "none".
      await invocation.execute({ kind: 'run', options: { input } }, { narrative: {} });
      return input;
    });
  }

  rawSnapshot() {
    return this.liveSnapshot();
  }
  rawNarrative() {
    return this.runExecution().view()?.getNarrativeEntries();
  }

  /** Exercise Agent's actual reader on a genuinely admitted view missing domain coverage. */
  getLastNarrativeEntries() {
    return Agent.prototype.getLastNarrativeEntries.call(this as unknown as Agent);
  }
}
