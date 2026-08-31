/**
 * The production scene, told in the Scope scene's own grammar.
 *
 * That scene reads: here is the state, here are the candidates, one is selected,
 * and here is what the selection resolves to. Deployment is the same sentence
 * with different nouns — pick a ground, and the adapters behind each port
 * resolve, while the thing on the left (your agent) does not move.
 *
 * It reuses SkillGraphScene's class names deliberately. The two scenes are the
 * same shape, so they should be the same component vocabulary; a parallel set of
 * near-identical classes is how two scenes drift apart visually over time.
 *
 * Every adapter named here ships — checked against src/adapters before writing.
 */
const GROUNDS = [
  { id: 'aws', label: 'AWS', state: 'selected' },
  { id: 'gcp', label: 'Google Cloud', state: 'not selected' },
  { id: 'foundry', label: 'Microsoft Foundry', state: 'not selected' },
  { id: 'own', label: 'Your own hardware', state: 'not selected' },
] as const;

const BOUND = [
  { label: 'Models', value: 'Bedrock' },
  { label: 'Memory', value: 'S3 · PostgreSQL' },
  { label: 'Runtime', value: 'AgentCore' },
  { label: 'Observe', value: 'CloudWatch · X-Ray' },
] as const;

export function PortsScene() {
  return (
    <figure className="v21-skillgraph">
      <figcaption className="v21-visually-hidden">
        The same agent runs on AWS, Google Cloud, Microsoft Foundry or your own hardware. Choosing
        AWS binds the model port to Bedrock, memory to S3 and PostgreSQL, the runtime to AgentCore,
        and observability to CloudWatch and X-Ray. The agent itself is unchanged.
      </figcaption>

      <div className="v21-skillgraph-topline" aria-hidden="true">
        <span>Deployment target</span>
        <strong>6 ports bound</strong>
      </div>

      <div className="v21-skillgraph-body" aria-hidden="true">
        <div className="v21-branch-field">
          <div className="v21-intent-node">
            <span>Your agent</span>
            <strong>unchanged</strong>
          </div>

          <i className="v21-fork-rail" />

          <ol className="v21-skill-candidates">
            {GROUNDS.map((ground) => (
              <li className={ground.state === 'selected' ? 'is-selected' : ''} key={ground.id}>
                <code>{ground.label}</code>
                <small>{ground.state}</small>
              </li>
            ))}
          </ol>
        </div>

        <i className="v21-selection-bridge" />

        <aside className="v21-skill-reveal">
          <header>
            <span>Bound adapters</span>
            <strong>AWS</strong>
          </header>
          <dl>
            {BOUND.map((item) => (
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
