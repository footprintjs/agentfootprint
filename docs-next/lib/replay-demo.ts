import evidence from './offline-replay-figure.json';
import { asset, quickStartDemoPath } from './site';

export const replayDemoViews = {
  replay: {
    id: 'offline-replay',
    title: 'Offline replay',
    guide: '/docs/debug/offline-replay/#replay-trace--the-chart-only-subset',
    fallback: 'See the recorded replay in the guide',
  },
  lens: {
    id: 'how-to-build-lens',
    title: 'See it in Lens',
    guide: '/how-to-build/#debug',
    fallback: 'See the Lens code in How to Build',
  },
} as const;

export const replayDemoVersion = evidence.agentFootprintVersion;

export function replayDemoHref(view: keyof typeof replayDemoViews) {
  const { id } = replayDemoViews[view];
  const query = new URLSearchParams({ view: id, agentfootprint: replayDemoVersion });
  return asset(`${quickStartDemoPath}?${query}#${id}`);
}
