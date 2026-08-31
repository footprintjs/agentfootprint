const CANDIDATE_SKILLS = [
  { id: 'invoice', label: 'billing.invoice', state: 'not selected' },
  { id: 'refund', label: 'billing.refund', state: 'selected' },
  { id: 'dispute', label: 'billing.dispute', state: 'not selected' },
] as const;

const WORKING_SET = [
  { label: 'Procedure', value: 'refund-policy.md' },
  { label: 'Tools', value: 'lookup · validate · issue' },
  { label: 'Model', value: 'task-small' },
] as const;

export function SkillGraphScene() {
  return (
    <figure className="v21-skillgraph">
      <figcaption className="v21-visually-hidden">
        A refund request selects billing.refund from several candidate skills. Only that skill&apos;s
        procedure, three tools, and model enter the working set.
      </figcaption>

      <div className="v21-skillgraph-topline" aria-hidden="true">
        <span>Skill index</span>
        <strong>1 reachable now</strong>
      </div>

      <div className="v21-skillgraph-body" aria-hidden="true">
        <div className="v21-branch-field">
          <div className="v21-intent-node">
            <span>Current state</span>
            <strong>refund requested</strong>
          </div>

          <i className="v21-fork-rail" />

          <ol className="v21-skill-candidates">
            {CANDIDATE_SKILLS.map((skill) => (
              <li className={skill.state === 'selected' ? 'is-selected' : ''} key={skill.id}>
                <code>{skill.label}</code>
                <small>{skill.state}</small>
              </li>
            ))}
          </ol>
        </div>

        <i className="v21-selection-bridge" />

        <aside className="v21-skill-reveal">
          <header>
            <span>Selected skill</span>
            <strong>billing.refund</strong>
          </header>
          <dl>
            {WORKING_SET.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </figure>
  );
}
