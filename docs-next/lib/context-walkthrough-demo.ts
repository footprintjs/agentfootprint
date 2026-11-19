import evidence from './context-walkthrough-figure.json';
import { asset, quickStartDemoPath } from './site';

export const contextWalkthroughDemo = {
  id: 'context-walkthrough',
  title: 'Context walkthrough',
  guide: '/context-engineering/#context-answer-story',
  fallback: 'See the recorded context in the lesson',
} as const;

export function contextWalkthroughHref(step: string) {
  const { id } = contextWalkthroughDemo;
  const query = new URLSearchParams({ view: id, agentfootprint: evidence.agentFootprintVersion, step });
  return asset(`${quickStartDemoPath}?${query}#${id}`);
}
