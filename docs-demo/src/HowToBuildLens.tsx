import type { PublishedDemoViewProps } from './DemoFrame';
import { DebugLensSample } from './samples/debug-lens';

export default function HowToBuildLens({ theme, themeToggle, provenance }: PublishedDemoViewProps) {
  return (
    <>
      <p className="cohort">Uses {provenance.cohort.join(', ')}.</p>
      <div className="controls">{themeToggle}</div>
      <DebugLensSample theme={theme} />
    </>
  );
}
