'use client';

import { useEffect, useState } from 'react';

/**
 * Shared theming for the live docs embeds (Dynamic ReAct trace, Skill graph).
 *
 * The lens + flow renderers read `--fp-*` CSS variables (dark defaults). We map
 * those to the docs palette — light values in light mode, dark in dark — so an
 * embed never looks out of place when the reader toggles the theme.
 */

export const LIGHT_THEME: React.CSSProperties = {
  ['--fp-bg-primary' as string]: '#ffffff',
  ['--fp-bg-secondary' as string]: '#f8fafc',
  ['--fp-bg-tertiary' as string]: '#eef2f7',
  ['--fp-bg-elevated' as string]: '#ffffff',
  ['--fp-text-primary' as string]: '#0f172a',
  ['--fp-text-secondary' as string]: '#475569',
  ['--fp-text-muted' as string]: '#94a3b8',
  ['--fp-border' as string]: '#e2e8f0',
  ['--fp-color-primary' as string]: '#6366f1',
  // Three semantic node-state colors (light variants).
  ['--fp-node-cursor' as string]: '#f59e0b', // current / scrubbed-to step
  ['--fp-node-visited' as string]: '#16a34a', // executed
  ['--fp-node-main' as string]: '#6366f1', // group's lead node
};

export const DARK_THEME: React.CSSProperties = {
  ['--fp-bg-primary' as string]: '#0b0b0f',
  ['--fp-bg-secondary' as string]: '#14141a',
  ['--fp-bg-tertiary' as string]: '#1c1c24',
  ['--fp-bg-elevated' as string]: '#16161d',
  ['--fp-text-primary' as string]: '#e8e8ea',
  ['--fp-text-secondary' as string]: '#b4b4bd',
  ['--fp-text-muted' as string]: '#8c887e',
  ['--fp-border' as string]: '#2a2a32',
  ['--fp-color-primary' as string]: '#818cf8',
  // Three semantic node-state colors (dark variants — slightly brighter).
  ['--fp-node-cursor' as string]: '#fbbf24',
  ['--fp-node-visited' as string]: '#22c55e',
  ['--fp-node-main' as string]: '#818cf8',
};

/** Surface colours for the embed chrome (caption, borders, input, panel bg). */
export function surfaceColors(isDark: boolean) {
  return isDark
    ? { border: '#2a2a32', chip: '#8c887e', inputBg: '#16161d', inputFg: '#e8e8ea', panelBg: '#0b0b0f' }
    : { border: '#e2e8f0', chip: '#64748b', inputBg: '#ffffff', inputFg: '#0f172a', panelBg: '#ffffff' };
}

/** Follow the docs theme (Fumadocs / next-themes toggles a `dark` class on <html>). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
