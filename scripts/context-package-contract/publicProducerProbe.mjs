/** Fixed public-entry specimen; expected versions are admitted independently by the driver. */
export function publicProducerProbe(format) {
  if (!['cjs', 'esm'].includes(format)) throw new TypeError('Unknown public producer format');
  const load = format === 'cjs' ? `
  const { Agent } = require('agentfootprint');
  const { MockProvider } = require('agentfootprint/providers');
  const { recordRun, buildRecordingEnvelope } = require('agentfootprint/observe');
  const entries = Object.fromEntries(['agentfootprint', 'agentfootprint/providers', 'agentfootprint/observe'].map((name) => [name, require.resolve(name)]));
` : `
  const [{ Agent }, { MockProvider }, { recordRun, buildRecordingEnvelope }] = await Promise.all([
    import('agentfootprint'), import('agentfootprint/providers'), import('agentfootprint/observe'),
  ]);
  const entries = Object.fromEntries(['agentfootprint', 'agentfootprint/providers', 'agentfootprint/observe'].map((name) => [name, import.meta.resolve(name)]));
`;
  return `
async function verifyPublicProducer() {
${load}
  const reply = 'native-public-producer-ok';
  const agent = Agent.create({ provider: new MockProvider({ replies: [reply], thinkingMs: 0, chunkDelayMs: 0 }), model: 'mock' })
    .system('Return the scripted reply.').build();
  const recorder = recordRun(agent);
  try {
    assert.equal(await agent.run({ message: 'Run the local producer specimen.' }), reply);
    const envelope = buildRecordingEnvelope(recorder, { run: { complete: true } });
    assert.equal(envelope.format, 'agentfootprint.recording.v1');
    assert.ok(envelope.recording.events.length > 0);
    assert.notEqual(envelope.recording.snapshot, undefined);
    assert.notEqual(envelope.recording.structure, undefined);
    assert.equal(envelope.run.droppedEvents, 0);
    process.stdout.write('af-public-producer ' + JSON.stringify({ format: '${format}', producer: envelope.producer, entries }) + '\\n');
  } finally {
    try { recorder.stop(); } finally { await agent.shutdown(); }
  }
}
verifyPublicProducer().catch((error) => { console.error(error); process.exitCode = 1; });
`;
}
