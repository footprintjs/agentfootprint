import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

export const calls = { count: 0 };
const agent = Agent.create({
  provider: mock({
    respond: () => {
      calls.count += 1;
      return { content: calls.count < 3 ? 'not yet' : 'all clear' };
    },
  }),
  model: 'mock',
}).build();
const passesMyCheck = (output: unknown) => String(output).includes('all clear');

// #region code
import { Loop } from 'agentfootprint';

// Re-run until your check passes, five times at most.
const nightly = Loop.create({ name: 'NightlyCheck' })
  .repeat(agent)
  .times(5)
  .until(({ latestOutput }) => passesMyCheck(latestOutput))
  .build();

// The timer is yours: cron, EventBridge or Cloud Scheduler. Each firing calls this.
export const onSchedule = () => nightly.run({ message: 'Check overnight refunds.' });
// #endregion code
