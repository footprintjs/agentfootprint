'use client';

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';

type InnerProps = {
  code?: ReactNode;
  demo?: 'support' | 'quickstart';
};

let innerPromise: Promise<ComponentType<InnerProps>> | undefined;

function loadInner() {
  // Keep the large graph renderer outside Next's route preloading. The import is
  // first invoked by the near-viewport observer, then shared by all instances.
  innerPromise ??= import('./SkillGraphTryItInner')
    .then((module) => module.default)
    .catch((error) => {
      innerPromise = undefined;
      throw error;
    });
  return innerPromise;
}

const DEMO_FILES = {
  support: 'components/demos/skillGraphDemo.ts',
  quickstart: 'components/demos/skillGraphQuickstartDemo.ts',
} as const;

function DeferredGraph({
  code,
  demo = 'support',
  state = 'deferred',
  onRetry,
}: {
  code?: ReactNode;
  demo?: keyof typeof DEMO_FILES;
  state?: 'deferred' | 'loading' | 'error';
  onRetry?: () => void;
}) {
  return (
    <div className="tryit" aria-busy={state === 'loading'}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          margin: '0 2px 6px',
          fontSize: 12,
          color: 'var(--af-fg-muted, #8c887e)',
        }}
      >
        <span>{DEMO_FILES[demo]} — the exact graph drawn below</span>
        <span>declared === drawn</span>
      </div>
      <div style={{ marginBottom: 10, maxHeight: 360, overflow: 'auto', borderRadius: 12 }}>
        {code}
      </div>
      <div
        style={{
          height: 460,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 12,
          border: '1px solid var(--af-border, #2a2a32)',
          color: 'var(--af-fg-muted, #8c887e)',
          fontSize: 14,
        }}
        role="status"
        aria-live="polite"
      >
        {state === 'error' ? (
          <span style={{ textAlign: 'center' }}>
            The interactive graph could not load.{' '}
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </span>
        ) : state === 'loading' ? (
          'Loading the interactive graph…'
        ) : (
          'Interactive graph loads as you approach it.'
        )}
      </div>
      <div aria-hidden="true" style={{ height: 28, marginTop: 8 }} />
    </div>
  );
}

/**
 * `children` is the server-rendered <CodeFile region="demo"> of the demo file
 * (the real code, read at build time). We forward it into the client island as
 * `code` so the shown bytes are the same file the drawn graph is built from.
 * `demo` picks which single-source demo backs the embed — `'support'` (default,
 * skillGraphDemo.ts) or `'quickstart'` (skillGraphQuickstartDemo.ts).
 */
export function SkillGraphTryIt({
  children,
  demo,
}: {
  children?: ReactNode;
  demo?: 'support' | 'quickstart';
}) {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [Inner, setInner] = useState<ComponentType<InnerProps>>();
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (!boundary || shouldLoad) return;

    // Older browsers get the demo immediately instead of being left with a
    // permanent placeholder. Modern browsers fetch it about one viewport ahead.
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: `${window.innerHeight}px 0px` },
    );

    observer.observe(boundary);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || Inner) return;

    let active = true;
    setLoadError(false);
    loadInner().then(
      (Component) => {
        if (active) setInner(() => Component);
      },
      () => {
        if (active) setLoadError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [Inner, loadAttempt, shouldLoad]);

  return (
    <div ref={boundaryRef}>
      {Inner ? (
        <Inner code={children} demo={demo} />
      ) : (
        <DeferredGraph
          code={children}
          demo={demo}
          state={loadError ? 'error' : shouldLoad ? 'loading' : 'deferred'}
          onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
        />
      )}
    </div>
  );
}

export default SkillGraphTryIt;
