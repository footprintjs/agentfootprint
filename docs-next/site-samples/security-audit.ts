import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const agent = Agent.create({ provider: mock({ reply: 'Audit done.' }), model: 'mock' }).build();

// #region code
import { auditExport, verifyAuditBundle } from 'agentfootprint/observe';

const audit = auditExport({ agent: 'refunds' });
const stop = agent.enable.observability({ strategy: audit });
await agent.run({ message: 'Refund A-1042.' });
stop();

const bundle = audit.bundle(); // plain JSON, store it anywhere
const check = verifyAuditBundle(bundle); // offline, with no agent
// { valid: true, recordsChecked: 14 }
// change one byte anywhere: { valid: false, brokenAt: 3, reason: 'hash mismatch …' }
// #endregion code

export { bundle, check, verifyAuditBundle };
