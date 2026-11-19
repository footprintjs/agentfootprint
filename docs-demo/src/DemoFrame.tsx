import type { ThemeMode } from 'footprint-explainable-ui/flowchart';
import { useState, type ReactNode } from 'react';

export interface DemoFrameContent {
  theme: ThemeMode;
  themeToggle: ReactNode;
}

export function DemoFrame({ children }: { children: (frame: DemoFrameContent) => ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const themeToggle = (
    <button
      type="button"
      aria-pressed={theme === 'dark'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      Dark theme
    </button>
  );

  return (
    <main data-theme={theme}>
      <article>{children({ theme, themeToggle })}</article>
    </main>
  );
}

export function RecordingCohort({
  provenance,
}: {
  provenance: { commit: string; cohort: readonly string[] };
}) {
  return (
    <p className="cohort">
      Recorded from commit{' '}
      <a href={`https://github.com/footprintjs/agentfootprint/commit/${provenance.commit}`}>
        <code>{provenance.commit.slice(0, 12)}</code>
      </a>{' '}
      with {provenance.cohort.join(', ')}.
    </p>
  );
}
