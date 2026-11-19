import { defineTool } from 'agentfootprint';
import { defineSkill, skillGraph } from 'agentfootprint/context';
import { Diagram } from '@/components/Diagram';
import { quickStartDemoPath } from '@/components/AgentFlowchart';
import { buildQuickstartSkillGraph } from '@/components/demos/skillGraphQuickstartDemo';
import provenance from '@/lib/skill-graph-figures.json';
import { SITE, asset } from '@/lib/site';

export const skillGraphViews = {
  quickstart: {
    id: 'skill-graph-quickstart',
    title: 'Quickstart skill graph',
    guide: '/docs/build/skill-graph-quickstart/#you-can-see-it',
    alt: 'The skill graph starts in refunds on a refund or money-back match, billing on charge or invoice, and triage otherwise.',
  },
  support: {
    id: 'skills-explained',
    title: 'Support skill graph',
    guide: '/docs/build/skills-explained/#routing-between-skills--the-skill-graph',
    alt: 'The support skill graph starts in triage and takes declared tool-result routes to billing or tech.',
  },
} as const;

export function SkillGraphFigure({ view }: { view: keyof typeof skillGraphViews }) {
  const { id, alt } = skillGraphViews[view];
  const figure = provenance.figures[view];
  const query = new URLSearchParams({ view: id, agentfootprint: provenance.agentFootprintVersion });
  const demoPath = `${quickStartDemoPath}?${query}#${id}`;
  return (
    <>
      <div className={view === 'quickstart' ? 'mx-auto max-w-md' : 'mx-auto max-w-xs'}>
        <Diagram
          name={figure.asset}
          alt={alt}
          width={figure.width}
          height={figure.height}
          caption={
            <>
              Recorded from mock runs with {provenance.cohort.join(', ')} from AgentFootprint commit{' '}
              <a href={`${SITE.repo}/commit/${provenance.commit}`}>
                <code>{provenance.commit.slice(0, 12)}</code>
              </a>
              .
            </>
          }
        />
      </div>
      <p><a href={asset(demoPath)}>Open the interactive skill graph</a> (AgentFootprint {provenance.agentFootprintVersion})</p>
    </>
  );
}

export function QuickstartSkillGraphMermaid() {
  const graph = buildQuickstartSkillGraph({ defineTool, defineSkill, skillGraph });
  return <pre><code>{graph.toMermaid()}</code></pre>;
}
