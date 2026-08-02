'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type HomeView = 'product' | 'technical';

type HomeViewContextValue = {
  view: HomeView;
  setView: (view: HomeView) => void;
};

const HomeViewContext = createContext<HomeViewContextValue | null>(null);

const VIEW_METADATA: Record<HomeView, { title: string; description: string }> = {
  product: {
    title: 'agentfootprint — Find the context that made your agent answer wrong',
    description:
      'Debug why your AI agent gave the wrong answer, trace it to the context that caused it, and prove the fix by replaying the run.',
  },
  technical: {
    title: 'agentfootprint — Context provenance and causal replay for AI agents',
    description:
      'Record context injections, model calls, tool decisions, state, and cost as typed evidence for backward slicing, ablation, and counterfactual replay.',
  },
};

function viewFromUrl(): HomeView {
  const requested = new URLSearchParams(window.location.search).get('view');
  return requested === 'technical' ? 'technical' : 'product';
}

export function HomeViewProvider({ children }: { children: ReactNode }) {
  const [view, setCurrentView] = useState<HomeView>('product');

  const applyView = useCallback((nextView: HomeView, updateUrl: boolean) => {
    setCurrentView(nextView);
    document.documentElement.dataset.homeView = nextView;
    document.title = VIEW_METADATA[nextView].title;
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute('content', VIEW_METADATA[nextView].description);

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('view', nextView);
      window.history.replaceState({ homeView: nextView }, '', url);
    }
  }, []);

  useEffect(() => {
    applyView(viewFromUrl(), false);
    const handlePopState = () => applyView(viewFromUrl(), false);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyView]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.title = VIEW_METADATA[view].title;
      document
        .querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.setAttribute('content', VIEW_METADATA[view].description);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [view]);

  const setView = useCallback(
    (nextView: HomeView) => applyView(nextView, true),
    [applyView],
  );
  const value = useMemo(() => ({ view, setView }), [setView, view]);

  return <HomeViewContext.Provider value={value}>{children}</HomeViewContext.Provider>;
}

export function useHomeView() {
  const context = useContext(HomeViewContext);
  if (!context) throw new Error('useHomeView must be used inside HomeViewProvider');
  return context;
}

export function HomeViewText({ product, technical }: { product: ReactNode; technical: ReactNode }) {
  const { view } = useHomeView();
  return view === 'technical' ? technical : product;
}

export function HomeViewSwitcher() {
  const { view, setView } = useHomeView();

  return (
    <div className="af-view-switcher" role="group" aria-label="Choose homepage view">
      <span className="af-view-label">View</span>
      {(['product', 'technical'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={view === option ? 'active' : ''}
          aria-pressed={view === option}
          onClick={() => setView(option)}
        >
          {option === 'product' ? 'Product' : 'Technical'}
        </button>
      ))}
    </div>
  );
}
