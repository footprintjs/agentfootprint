// #region code
import { structureGraphFromSpec } from 'agentfootprint-lens/core';
import { ExplainableShell, overlayFromSnapshot, type ExplainableShellProps } from 'footprint-explainable-ui';

type FlowRecording = {
  snapshot: NonNullable<ExplainableShellProps['runtimeSnapshot']>;
  structure: unknown;
};

export function FlowLens({ recording }: { recording: FlowRecording }) {
  return (
    <ExplainableShell
      runtimeSnapshot={recording.snapshot}
      traceGraph={structureGraphFromSpec(recording.structure)}
      runtimeOverlay={overlayFromSnapshot(recording.snapshot)}
      traceTheme={{ mode: 'light' }}
    />
  );
}
// #endregion code
