'use client';

import dynamic from 'next/dynamic';

/* It brings the home film's copy with it, so it loads after the page, the same way the scenes do. */
export const LazyUniverse = dynamic(
  () => import('@/components/home/stand/StandUniverse').then((module) => module.StandUniverse),
  { ssr: false, loading: () => <div className="su" aria-hidden="true" /> },
);
