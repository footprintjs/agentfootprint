import { mock } from 'agentfootprint/providers';

const provider = mock({ reply: 'Three failures since 8.' });

// #region code
import { Agent } from 'agentfootprint';

const agent = Agent.create({ provider, model: 'mock' })
  .time({ zone: 'America/Los_Angeles' }) // the fallback, and each run's own zone wins
  .build();

await agent.run({
  message: 'Any errors since 8?',
  time: { now: '2026-11-05T17:30:00Z', zone: 'America/New_York' },
});

const clock = agent.findings()?.find((row) => row.kind === 'clock');
// { kind: 'clock', now: '2026-11-05T17:30:00Z', nowSource: 'app', zone: 'America/New_York', zoneSource: 'run' }
// #endregion code

export { clock };

/* Nothing declared: the run still goes, and its record says the zone is unknown. */
const undeclared = Agent.create({ provider, model: 'mock' }).time().build();
await undeclared.run({ message: 'Any errors since 8?' });
export const undeclaredClock = undeclared.findings()?.find((row) => row.kind === 'clock');
