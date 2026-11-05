'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { VIEWS, type ViewKey } from './copy';

const STORE_KEY = 'af-stand-view';

interface ViewState {
  readonly view: ViewKey;
  readonly setView: (view: ViewKey) => void;
}

const ViewContext = createContext<ViewState>({ view: 'product', setView: () => undefined });

export function useStandView() {
  return useContext(ViewContext);
}

/** Product, Technical or Business. The words change, and nothing else does. */
export function StandViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<ViewKey>('product');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORE_KEY);
      if (saved && VIEWS.some((v) => v.key === saved)) setViewState(saved as ViewKey);
    } catch {
      /* private window or blocked storage: the default view is fine */
    }
  }, []);
  const setView = (next: ViewKey) => {
    setViewState(next);
    try {
      window.localStorage.setItem(STORE_KEY, next);
    } catch {
      /* the choice just will not persist */
    }
  };
  return <ViewContext.Provider value={{ view, setView }}>{children}</ViewContext.Provider>;
}

export function ViewSwitch({ className }: { className?: string }) {
  const { view, setView } = useStandView();
  return (
    <div className={`sf-views${className ? ` ${className}` : ''}`} role="group" aria-label="View as">
      <span className="sf-views-label">View as</span>
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={view === v.key}
          className={view === v.key ? 'on' : undefined}
          onClick={() => setView(v.key)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
