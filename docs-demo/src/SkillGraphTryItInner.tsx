import { SkillGraphFlow, type SkillGraphView } from 'agentfootprint-lens';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { RecordingCohort } from './DemoFrame';
import skillGraphs from './generated/skill-graphs.json';
import './skill-graph.css';

export type SkillGraphDemo = 'quickstart' | 'support';

export interface SkillGraphViewProps {
  demo: SkillGraphDemo;
  themeToggle: ReactNode;
  version: string | null;
}

const { provenance } = skillGraphs;

export default function SkillGraphTryItInner({ demo, themeToggle, version }: SkillGraphViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { graph, skills } = skillGraphs[demo];

  if (version !== null && !provenance.cohort.includes(`agentfootprint@${version}`)) {
    return (
      <p>The interactive viewer is unavailable for this version. The guide has the recorded diagram.</p>
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Escape') return;
    if (!(event.target instanceof HTMLElement)) return;
    const node = event.target.closest<HTMLElement>('.react-flow__node');
    const nodeId = node?.dataset.id;
    if (!nodeId || !skills.some(({ id }) => id === nodeId)) return;

    // React Flow handles keyboard selection on the canvas. Lens opens its
    // detail panel from its separate selection state, which we control here.
    event.preventDefault();
    setSelectedId(event.key === 'Escape' ? null : nodeId);
  }

  return (
    <>
      <RecordingCohort provenance={provenance} />
      <div className="controls">{themeToggle}</div>
      <p id="chart-help">
        Select a skill to inspect its playbook and tools. Use Tab and Enter to select by keyboard.{' '}
        {demo === 'quickstart' ? (
          <>The first matching rule from START chooses the skill.</>
        ) : (
          <>
            Solid edges are declared steps. Dashed edges are skills the model can reach with{' '}
            <code>read_skill</code>.
          </>
        )}
      </p>
      <section
        className="chart skill-graph"
        aria-label="Skill graph"
        aria-describedby="chart-help"
        onKeyDown={handleKeyDown}
      >
        <SkillGraphFlow
          className="skill-graph-flow"
          graph={graph as SkillGraphView}
          selectedId={selectedId}
          onSelectNode={setSelectedId}
          detailFor={(node) => skills.find(({ id }) => id === node.id)}
        />
      </section>
    </>
  );
}
