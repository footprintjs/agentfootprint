// #region code
import { Lens, observeRecording, type Recording } from 'agentfootprint-lens';
import { useMemo } from 'react';

export function WhyLens({ recording }: { recording: Recording }) {
  const { recorder, runner, boundaryRanges } = useMemo(
    () => observeRecording(recording),
    [recording],
  );

  return (
    <>
      {boundaryRanges === 0 && <p>This recording has no step boundaries.</p>}
      <Lens recorder={recorder} runner={runner} theme={{ mode: 'light' }} />
    </>
  );
}
// #endregion code
