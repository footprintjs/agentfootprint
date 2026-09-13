import type { ReactNode } from 'react';
import SkillGraphTryItClient from './SkillGraphTryItClient';
import { buildSkillGraphDemoData, type SkillGraphDemo } from './SkillGraphTryItData';

/** The source code and compiled graph are both prepared on the server. Only the
 * graph's plain view data crosses into the deferred interactive client island.
 */
export function SkillGraphTryIt({ children, demo = 'support' }: {
  children?: ReactNode;
  demo?: SkillGraphDemo;
}) {
  return <SkillGraphTryItClient data={buildSkillGraphDemoData(demo)}>{children}</SkillGraphTryItClient>;
}

export default SkillGraphTryIt;
