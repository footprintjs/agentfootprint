/** The independently reproduced T4 receipt. The benchmark gate checks every field against its source. */
export const provenLookback = {
  receipt: '48a8d25bae43df14516bad7786071ae7ba2a2a54ac5398326bc452e43d26484f',
  worker: '968a307ff3f2aaf2e9a4c99428bc40d3d4a3ce71a89e23bd1ed45da75ee791a0',
  manifest: '47701ead8f5cfb3bc1a02047c0e71b5372c3a55864258386b51b762e23f82bbb',
  grammar: '2ec98650e78ca926ba29d0a064a7afb8ceb00226f392ce4bd14542320a665039',
  reader: { id: 'agentfootprint/english', version: '1.4.0', kind: 'rule', locale: 'en-US' },
  runtime: { node: '24.21.0', tz: '2026c', icu: '78.3' },
  phrases: [
    'last 2 hours',
    'past 2 hours',
    'last 2 hrs',
    'last 2h',
    'past 40 minutes',
    'last 1 minute',
  ],
  appZones: ['UTC', 'America/Los_Angeles', 'Asia/Kolkata'],
  processZones: ['UTC', 'America/Los_Angeles', 'America/New_York', 'Asia/Kolkata'],
} as const;
