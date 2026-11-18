import { expect, it } from 'vitest';
import { eventShapes } from '../../../../src/adapters/observability/auditShapes.js';
import { VM, QUESTION, proposal, batch, correctionFixture } from './sourceCorrectionHarness.js';

it.each([
  { field: 'correction', value: 'source-declaration-required', preempted: false },
  { field: 'withheld', value: 'batch-preempted', preempted: true },
] as const)(
  'retains the actual native $field observation in the closed audit view',
  async ({ field, value, preempted }) => {
    const fixture = correctionFixture([
      batch(
        proposal('audit-held', { vm: VM }),
        ...(preempted ? [{ id: 'invalid-name', name: '', args: {} }] : []),
      ),
      'Done.',
    ]);
    try {
      expect(await fixture.agent.run(QUESTION)).toBe('Done.');
      const event = fixture.events.find(
        (event) =>
          event.type === 'agentfootprint.findings.argument' &&
          event.payload.toolCallId === 'audit-held',
      );
      if (event?.type !== 'agentfootprint.findings.argument')
        throw new Error('Expected native argument observation');
      expect(event.payload).toMatchObject({ claimed: 'none', [field]: value });
      const shape = eventShapes(() => false)['agentfootprint.findings.argument'];
      expect(shape(event.payload)).toMatchObject({
        toolCallId: 'audit-held',
        claimed: 'none',
        [field]: value,
      });
      // Only the exact finite word passes. Unknown caller bytes acquire no audit authority.
      expect(shape({ ...event.payload, [field]: 'synthetic-untrusted-value' })).toHaveProperty(
        field,
        expect.stringMatching(/^\[\d+ chars\]$/),
      );
    } finally {
      await fixture.agent.shutdown();
    }
  },
);
