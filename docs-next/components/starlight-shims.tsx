import { Callout } from 'fumadocs-ui/components/callout';
import { Card as FumaCard, Cards as FumaCards } from 'fumadocs-ui/components/card';
import { Tab as FumaTab, Tabs as FumaTabs } from 'fumadocs-ui/components/tabs';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

/**
 * Starlight → Fumadocs component shims, registered globally in mdx-components so the
 * docs ported from the Starlight site render without per-file rewrites (their
 * `@astrojs/starlight/components` imports are stripped on port).
 */

const ASIDE_TO_CALLOUT: Record<string, 'info' | 'warn' | 'error'> = {
  tip: 'info',
  note: 'info',
  info: 'info',
  caution: 'warn',
  warning: 'warn',
  danger: 'error',
};

export function Aside({
  type = 'note',
  title,
  children,
}: {
  type?: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <Callout type={ASIDE_TO_CALLOUT[type] ?? 'info'} title={title}>
      {children}
    </Callout>
  );
}

export function CardGrid({ children }: { children?: ReactNode }) {
  return <FumaCards>{children}</FumaCards>;
}

export function Card({
  title,
  children,
}: {
  title?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return <FumaCard title={title ?? ''}>{children}</FumaCard>;
}

function labelOf(child: ReactElement): string {
  return (child.props as { label?: string }).label ?? '';
}

export function Tabs({ children }: { children?: ReactNode }) {
  const tabs = Children.toArray(children).filter(isValidElement) as ReactElement[];
  const items = tabs.map(labelOf);
  return (
    <FumaTabs items={items}>
      {tabs.map((child, i) => (
        <FumaTab key={i} value={labelOf(child) || String(i)}>
          {(child.props as { children?: ReactNode }).children}
        </FumaTab>
      ))}
    </FumaTabs>
  );
}

export function TabItem({ children }: { label?: string; children?: ReactNode }) {
  return <>{children}</>;
}
