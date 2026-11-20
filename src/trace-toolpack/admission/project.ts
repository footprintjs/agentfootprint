import type { CommitBundle } from 'foottrace';
import type { StageSnapshot } from 'footprintjs/advanced';
import type { AgentfootprintEvent } from '../../events/registry.js';
import type { TraceToolpackArtifacts } from '../types.js';
import { traceHistoryProjector } from './history.js';
import { TRACE_WITHHELD } from './marker.js';

const MAX_COMMITS = 8192;
const MAX_STAGES = 8192;
const MAX_WRITES_PER_COMMIT = 4096;

/** Read a recorded data slot without invoking an accessor on a supplied snapshot. */
function own(value: unknown, key: PropertyKey): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

type Project = (value: unknown) => unknown;

function stateReaders(decisions: unknown): ReadonlyMap<string, Project> {
  return new Map<string, Project>([
    // The history projection admits only conversation and delivered tool message fields.
    ['history', traceHistoryProjector(decisions)],
    // seedConversationTurn derives this counter from the conversation, not from tool output.
    [
      'turnNumber',
      (value) => (Number.isSafeInteger(value) && (value as number) >= 0 ? value : TRACE_WITHHELD),
    ],
  ]);
}

function stateView(value: unknown, readers: ReadonlyMap<string, Project>) {
  const result: Record<string, unknown> = {};
  for (const [key, project] of readers) {
    const field = own(value, key);
    if (field !== undefined) result[key] = project(field);
  }
  return result;
}

function commitView(bundle: CommitBundle, readers: ReadonlyMap<string, Project>): CommitBundle {
  const trace: CommitBundle['trace'] = [];
  const overwrite: CommitBundle['overwrite'] = {};
  if (bundle.trace.length > MAX_WRITES_PER_COMMIT) throw Error(TRACE_WITHHELD);
  const writes = new Map<string, CommitBundle['trace'][number]>();
  for (const write of bundle.trace) {
    if (readers.has(write.path)) writes.set(write.path, write);
  }
  // Admit whole keys only. A result can determine nested property names as well as their values.
  // Preserve replay for the allowed root writes the engine emits for history and turnNumber.
  for (const [key, project] of readers) {
    const write = writes.get(key);
    const verb = own(write, 'verb');
    if (verb === 'delete') {
      trace.push({ path: key, verb });
      overwrite[key] = undefined;
    } else if (verb === 'set' || verb === 'append') {
      const field = own(bundle.overwrite, key);
      if (field !== undefined) {
        const admitted = project(field);
        if (verb === 'append' && !Array.isArray(admitted)) continue;
        trace.push({
          path: key,
          verb,
          ...(verb === 'set' && own(write, 'builtOnView') === true && { builtOnView: true }),
        });
        overwrite[key] = admitted;
      }
    }
  }

  return {
    stage: bundle.stage,
    stageId: bundle.stageId,
    runtimeStageId: bundle.runtimeStageId,
    idx: bundle.idx,
    phase: bundle.phase,
    beganAt: bundle.beganAt,
    sawUntil: bundle.sawUntil,
    viewAt: bundle.viewAt,
    trace,
    overwrite,
    updates: {},
    redactedPaths: [],
  };
}

function stageView(root: StageSnapshot): StageSnapshot {
  function shell(stage: StageSnapshot): StageSnapshot {
    return {
      id: stage.id,
      runtimeStageId: stage.runtimeStageId,
      name: stage.name,
      description: stage.description,
      subflowId: stage.subflowId,
      isDecider: stage.isDecider,
      isFork: stage.isFork,
      logs: {},
      errors: {},
      metrics: {},
      evals: {},
    };
  }

  const admitted = shell(root);
  const pending = [{ source: root, target: admitted }];
  const seen = new Set([root]);
  let count = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined || ++count > MAX_STAGES) throw Error(TRACE_WITHHELD);
    const { source, target } = entry;
    const attach = (stage: StageSnapshot): StageSnapshot => {
      if (seen.has(stage) || seen.size >= MAX_STAGES) throw Error(TRACE_WITHHELD);
      seen.add(stage);
      const child = shell(stage);
      pending.push({ source: stage, target: child });
      return child;
    };
    if (source.next !== undefined) target.next = attach(source.next);
    if (source.children !== undefined) target.children = source.children.map(attach);
  }
  return admitted;
}

/** Iteration entry precedes tool results. The remaining event families stay private. */
function admittedEvents(events: TraceToolpackArtifacts['events']): AgentfootprintEvent[] {
  if (events === undefined) return [];
  if (events.length > MAX_COMMITS) throw Error(TRACE_WITHHELD);
  const result: AgentfootprintEvent[] = [];
  for (const event of events) {
    if (event.type !== 'agentfootprint.agent.iteration_start') continue;
    const { turnIndex, iterIndex } = event.payload;
    const { runId, runtimeStageId, wallClockMs, runOffsetMs } = event.meta;
    if (!Number.isSafeInteger(turnIndex) || !Number.isSafeInteger(iterIndex)) continue;
    result.push({
      type: event.type,
      payload: { turnIndex, iterIndex },
      meta: {
        runId,
        runtimeStageId,
        wallClockMs,
        runOffsetMs,
        subflowPath: [],
        compositionPath: [],
      },
    });
  }
  return result;
}

/** Give all pack readers the same detached, restricted state and replay log. */
export function projectTraceArtifacts(artifacts: TraceToolpackArtifacts): TraceToolpackArtifacts {
  const { snapshot } = artifacts;
  const readers = stateReaders(own(snapshot.sharedState, 'middlewareDecisions'));
  if (snapshot.commitLog.length > MAX_COMMITS) throw Error(TRACE_WITHHELD);
  return {
    snapshot: {
      runId: snapshot.runId,
      commitValues: snapshot.commitValues,
      writeProvenance: snapshot.writeProvenance,
      initialState: stateView(snapshot.initialState, readers),
      sharedState: stateView(snapshot.sharedState, readers),
      commitLog: snapshot.commitLog.map((bundle) => commitView(bundle, readers)),
      executionTree: stageView(snapshot.executionTree),
    },
    narrative: [TRACE_WITHHELD],
    events: admittedEvents(artifacts.events),
  };
}
