type AgentConstructorInputs = Parameters<typeof configureAgent> extends [
  unknown,
  unknown,
  ...infer Inputs,
]
  ? Inputs
  : never;
import { configureAgent } from '../configuration/configure.js';
import { hostedTurns } from '../../hostTurn.js';
import { refuseMountedWrapper, replacedTurnMethods } from '../../aroundTurn/index.js';
import { componentResources } from '../../componentResources.js';
import { capturePauseOwnership, abandonStoredPause } from '../../pauseOwnership.js';
import { registerRunnerLive, runnerLive } from '../../../runnerLive.js';
import { agentComponentObservers } from '../../componentObservers.js';
import { bindScopeComputation, captureLateEmitter } from '../../../../redaction/runRedaction.js';
import { createAgentRunValues } from '../../runValues.js';

import { registerServingConversation } from '../../servingConversation.js';

import { TOOL_TEARDOWN_STAGE_ID } from '../../run/eventStageIds.js';
import type { AgentContext } from '../contracts.js';

export function initializeAgent(
  this: Pick<
    AgentContext,
    | 'beginIntegrityLedger'
    | 'buildChart'
    | 'checkpointFor'
    | 'configuration'
    | 'id'
    | 'native'
    | 'ownTurnMethods'
    | 'resumeOwned'
    | 'runOwned'
    | 'runner'
    | 'toolSessions'
  >,
  ...args: AgentConstructorInputs
) {
  // Which conversation this instance's self-explain evidence belongs to —
  // held in a module registry, not on the class, so it is not public API
  // (`agent/servingConversation.ts`).
  registerServingConversation(this.runner, () => {
    const selected = this.native.runExecution().selected();
    const conversation = selected?.value.servingConversation;
    return {
      conversation,
      runId: selected?.context.runId ?? 'pending',
      ...(conversation?.startsWith('hosted:') === true && { oneShot: true }),
    };
  });
  configureAgent(this.configuration, this.runner, ...args);

  // Build the chart once. Private executable tool catalogs and their domain
  // handlers are initialized in the actual native component, shared with
  // its internal charts and isolated from other mounts and admissions.
  this.native.initChart(() => this.buildChart(), {
    runnerId: this.id,
    compositionPath: [`Agent:${this.id}`],
    initialize: () => {
      const values = createAgentRunValues({
        window: this.configuration.windowStrategy !== undefined,
        answerLayer: this.configuration.answerLayerOption !== undefined,
      });
      this.beginIntegrityLedger(values);
      return values;
    },
    options: {
      readTracking: this.configuration.readTracking,
      commitValues: this.configuration.commitValues,
      writeProvenance: this.configuration.writeProvenance,
    },
    componentSetup: (component, value, entry) => {
      value.resources = componentResources(component, () => this.toolSessions());
      if (entry?.kind === 'resume') value.resources.expectAnswer();
      const observers = agentComponentObservers(component, value, entry, {
        causal: this.configuration.memories.some((memory) => memory.type === 'causal'),
        window: this.configuration.windowStrategy !== undefined,
      });
      return {
        recorder: observers.recorder,
        bindScope: (scope) => {
          // No entry: mounted in a run this agent did not start. Refused as its
          // first stage opens, where the mounting run's recorders hear the name.
          if (entry === undefined) refuseMountedWrapper(this.configuration.aroundTurnPort);
          const run = this.native.runExecution().forScope(scope);
          value.resources?.bindReporter((status) =>
            captureLateEmitter(scope as object, TOOL_TEARDOWN_STAGE_ID)?.(
              'agentfootprint.tools.resource_restore',
              status,
            ),
          );
          bindScopeComputation(scope, {
            owner: component,
            retired: () => run.retired,
            emit: observers.emit,
          });
        },
      };
    },
  });
  const live = runnerLive(this.runner);
  if (live === undefined) throw new TypeError('Agent live taps were not initialized');
  registerRunnerLive(this.runner, {
    ...live,
    turn: hostedTurns(this.native.runExecution(), {
      run: (run, input, options) => this.runOwned(run, input, options),
      resume: (run, checkpoint, input, options) =>
        this.resumeOwned(run, checkpoint, input, options),
      prepareResume: (checkpoint) => this.native.noteResumeTakenUp(checkpoint),
      checkpoint: (run) => this.checkpointFor(run),
      replaced: () => replacedTurnMethods(this.runner, this.ownTurnMethods),
    }),
    pause: {
      capture: (outcome) =>
        capturePauseOwnership(this.native.runExecution().selected()?.value, outcome),
      abandon: (checkpoint) =>
        this.native
          .runExecution()
          .withRun(() => abandonStoredPause(checkpoint, () => this.toolSessions())),
    },
  });
}
