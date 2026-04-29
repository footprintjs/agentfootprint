[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EVENT\_NAMES

# Variable: EVENT\_NAMES

> `const` **EVENT\_NAMES**: `object`

Defined in: [agentfootprint/src/events/registry.ts:71](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/registry.ts#L71)

## Type Declaration

### agent

> `readonly` **agent**: `object`

#### agent.handoff

> `readonly` **handoff**: `"agentfootprint.agent.handoff"` = `'agentfootprint.agent.handoff'`

#### agent.iterationEnd

> `readonly` **iterationEnd**: `"agentfootprint.agent.iteration_end"` = `'agentfootprint.agent.iteration_end'`

#### agent.iterationStart

> `readonly` **iterationStart**: `"agentfootprint.agent.iteration_start"` = `'agentfootprint.agent.iteration_start'`

#### agent.routeDecided

> `readonly` **routeDecided**: `"agentfootprint.agent.route_decided"` = `'agentfootprint.agent.route_decided'`

#### agent.turnEnd

> `readonly` **turnEnd**: `"agentfootprint.agent.turn_end"` = `'agentfootprint.agent.turn_end'`

#### agent.turnStart

> `readonly` **turnStart**: `"agentfootprint.agent.turn_start"` = `'agentfootprint.agent.turn_start'`

### composition

> `readonly` **composition**: `object`

#### composition.branchComplete

> `readonly` **branchComplete**: `"agentfootprint.composition.branch_complete"` = `'agentfootprint.composition.branch_complete'`

#### composition.enter

> `readonly` **enter**: `"agentfootprint.composition.enter"` = `'agentfootprint.composition.enter'`

#### composition.exit

> `readonly` **exit**: `"agentfootprint.composition.exit"` = `'agentfootprint.composition.exit'`

#### composition.forkStart

> `readonly` **forkStart**: `"agentfootprint.composition.fork_start"` = `'agentfootprint.composition.fork_start'`

#### composition.iterationExit

> `readonly` **iterationExit**: `"agentfootprint.composition.iteration_exit"` = `'agentfootprint.composition.iteration_exit'`

#### composition.iterationStart

> `readonly` **iterationStart**: `"agentfootprint.composition.iteration_start"` = `'agentfootprint.composition.iteration_start'`

#### composition.mergeEnd

> `readonly` **mergeEnd**: `"agentfootprint.composition.merge_end"` = `'agentfootprint.composition.merge_end'`

#### composition.routeDecided

> `readonly` **routeDecided**: `"agentfootprint.composition.route_decided"` = `'agentfootprint.composition.route_decided'`

### context

> `readonly` **context**: `object`

#### context.budgetPressure

> `readonly` **budgetPressure**: `"agentfootprint.context.budget_pressure"` = `'agentfootprint.context.budget_pressure'`

#### context.evicted

> `readonly` **evicted**: `"agentfootprint.context.evicted"` = `'agentfootprint.context.evicted'`

#### context.injected

> `readonly` **injected**: `"agentfootprint.context.injected"` = `'agentfootprint.context.injected'`

#### context.slotComposed

> `readonly` **slotComposed**: `"agentfootprint.context.slot_composed"` = `'agentfootprint.context.slot_composed'`

### cost

> `readonly` **cost**: `object`

#### cost.limitHit

> `readonly` **limitHit**: `"agentfootprint.cost.limit_hit"` = `'agentfootprint.cost.limit_hit'`

#### cost.tick

> `readonly` **tick**: `"agentfootprint.cost.tick"` = `'agentfootprint.cost.tick'`

### embedding

> `readonly` **embedding**: `object`

#### embedding.generated

> `readonly` **generated**: `"agentfootprint.embedding.generated"` = `'agentfootprint.embedding.generated'`

### error

> `readonly` **error**: `object`

#### error.fatal

> `readonly` **fatal**: `"agentfootprint.error.fatal"` = `'agentfootprint.error.fatal'`

#### error.recovered

> `readonly` **recovered**: `"agentfootprint.error.recovered"` = `'agentfootprint.error.recovered'`

#### error.retried

> `readonly` **retried**: `"agentfootprint.error.retried"` = `'agentfootprint.error.retried'`

### eval

> `readonly` **eval**: `object`

#### eval.score

> `readonly` **score**: `"agentfootprint.eval.score"` = `'agentfootprint.eval.score'`

#### eval.thresholdCrossed

> `readonly` **thresholdCrossed**: `"agentfootprint.eval.threshold_crossed"` = `'agentfootprint.eval.threshold_crossed'`

### fallback

> `readonly` **fallback**: `object`

#### fallback.triggered

> `readonly` **triggered**: `"agentfootprint.fallback.triggered"` = `'agentfootprint.fallback.triggered'`

### memory

> `readonly` **memory**: `object`

#### memory.attached

> `readonly` **attached**: `"agentfootprint.memory.attached"` = `'agentfootprint.memory.attached'`

#### memory.detached

> `readonly` **detached**: `"agentfootprint.memory.detached"` = `'agentfootprint.memory.detached'`

#### memory.strategyApplied

> `readonly` **strategyApplied**: `"agentfootprint.memory.strategy_applied"` = `'agentfootprint.memory.strategy_applied'`

#### memory.written

> `readonly` **written**: `"agentfootprint.memory.written"` = `'agentfootprint.memory.written'`

### pause

> `readonly` **pause**: `object`

#### pause.request

> `readonly` **request**: `"agentfootprint.pause.request"` = `'agentfootprint.pause.request'`

#### pause.resume

> `readonly` **resume**: `"agentfootprint.pause.resume"` = `'agentfootprint.pause.resume'`

### permission

> `readonly` **permission**: `object`

#### permission.check

> `readonly` **check**: `"agentfootprint.permission.check"` = `'agentfootprint.permission.check'`

#### permission.gateClosed

> `readonly` **gateClosed**: `"agentfootprint.permission.gate_closed"` = `'agentfootprint.permission.gate_closed'`

#### permission.gateOpened

> `readonly` **gateOpened**: `"agentfootprint.permission.gate_opened"` = `'agentfootprint.permission.gate_opened'`

### risk

> `readonly` **risk**: `object`

#### risk.flagged

> `readonly` **flagged**: `"agentfootprint.risk.flagged"` = `'agentfootprint.risk.flagged'`

### skill

> `readonly` **skill**: `object`

#### skill.activated

> `readonly` **activated**: `"agentfootprint.skill.activated"` = `'agentfootprint.skill.activated'`

#### skill.deactivated

> `readonly` **deactivated**: `"agentfootprint.skill.deactivated"` = `'agentfootprint.skill.deactivated'`

### stream

> `readonly` **stream**: `object`

#### stream.llmEnd

> `readonly` **llmEnd**: `"agentfootprint.stream.llm_end"` = `'agentfootprint.stream.llm_end'`

#### stream.llmStart

> `readonly` **llmStart**: `"agentfootprint.stream.llm_start"` = `'agentfootprint.stream.llm_start'`

#### stream.token

> `readonly` **token**: `"agentfootprint.stream.token"` = `'agentfootprint.stream.token'`

#### stream.toolEnd

> `readonly` **toolEnd**: `"agentfootprint.stream.tool_end"` = `'agentfootprint.stream.tool_end'`

#### stream.toolStart

> `readonly` **toolStart**: `"agentfootprint.stream.tool_start"` = `'agentfootprint.stream.tool_start'`

### tools

> `readonly` **tools**: `object`

#### tools.activated

> `readonly` **activated**: `"agentfootprint.tools.activated"` = `'agentfootprint.tools.activated'`

#### tools.deactivated

> `readonly` **deactivated**: `"agentfootprint.tools.deactivated"` = `'agentfootprint.tools.deactivated'`

#### tools.offered

> `readonly` **offered**: `"agentfootprint.tools.offered"` = `'agentfootprint.tools.offered'`
