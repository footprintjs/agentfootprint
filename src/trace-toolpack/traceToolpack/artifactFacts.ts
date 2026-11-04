import type { TraceToolpackArtifacts } from '../types.js';
import type { ControlDepLookup } from 'foottrace';

/**
 * Artifact bags whose pack must not name `inspect_subflow` — the inner packs
 * `inspect_tool_run` opens. Internal to this folder on purpose: not an option a
 * consumer sets, a fact about how the pack is reached.
 */
const WITHOUT_SUBFLOW_DOOR = new WeakSet<TraceToolpackArtifacts>();

/**
 * The run's own control-dependence lookup, keyed by every subflow bag opened
 * below it — so each level filters the RUN's edges to its own log
 * (`openSubflowArtifacts`), at any depth.
 */
const RAW_CONTROL_DEPS = new WeakMap<TraceToolpackArtifacts, ControlDepLookup>();

export { WITHOUT_SUBFLOW_DOOR, RAW_CONTROL_DEPS };
