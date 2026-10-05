import type { EventMeta, EventSourcePosition } from '../../src/events.js';

const source: EventSourcePosition = {
  engineRunId: 'engine-leg',
  logRunId: 'owning-leg',
  drillPath: ['mount#1'],
  committedThroughIdx: -1,
};

const accept = (event: EventMeta): EventSourcePosition | undefined => event.sourcePosition;
void accept;
void source;

// @ts-expect-error Coordinates are immutable wire evidence.
source.engineRunId = 'another-leg';
// @ts-expect-error The mount path is immutable too.
source.drillPath.push('another-mount');
// @ts-expect-error Engine and agent run identities have different field names.
const wrongNamespace: EventSourcePosition = { runId: 'agent-run' };
void wrongNamespace;
