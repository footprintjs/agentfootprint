/** One inert native pause from the actual registry installation; never edits a checkpoint. */
import { Agent, defineTool, englishTimeReader, isInputPause } from 'agentfootprint';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const packageOf = (name) => {
  let folder = dirname(require.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
      if (manifest.name === name) return { folder, manifest };
    } catch {}
    const parent = dirname(folder);
    if (parent === folder) throw Error('Missing writer package');
    folder = parent;
  }
};
const message = 'Show activity in the last 2 hours';
const clock = { now: '2026-11-06T18:01:00Z', zone: 'UTC' };
const seen = [];
let completed = 0;
const provider = {
  name: 'fixed-native-time-reply',
  complete: async () => ({
    content: '',
    toolCalls: [{ id: 'read-1', name: 'read_window', args: {} }],
    usage: { input: 0, output: 0 },
  }),
};
const tool = defineTool({
  name: 'read_window',
  description: 'Read one synthetic interval.',
  inputSchema: {
    type: 'object',
    properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
  },
  askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
  period: {
    forms: [
      {
        kind: 'bounds',
        from: { argument: 'start_time', as: 'epoch-ms' },
        to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
      },
    ],
  },
  execute: (args) => {
    seen.push(args);
    completed++;
    return { rows: [{ value: 1 }] };
  },
});
const agent = Agent.create({ provider, model: 'mock', maxIterations: 3 })
  .tool(tool)
  .time({ zone: 'UTC', reader: englishTimeReader(), policy: { year: 'current' } })
  .build();
try {
  const pause = await agent.run({ message, time: clock });
  if (!isInputPause(pause) || completed !== 0)
    throw Error('Writer did not stop at the actual native time ask');
  const field = pause.awaitingInput.fields.find((field) => field.format === 'time-range');
  if (!field?.enum?.length) throw Error('Writer has no offered interval');
  const payload = JSON.stringify(pause.checkpoint, null, 2) + '\n';
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const packages = Object.fromEntries(
    ['agentfootprint', 'footprintjs', 'foottrace'].map((name) => {
      const { folder, manifest } = packageOf(name),
        entry = lock.packages[`node_modules/${name}`];
      if (!entry || manifest.version !== entry.version)
        throw Error('Writer lock and actual package disagree');
      return [
        name,
        {
          version: manifest.version,
          resolved: entry.resolved,
          integrity: entry.integrity,
          entrySHA256: hash(readFileSync(require.resolve(name))),
          packageRoot: folder,
        },
      ];
    }),
  );
  if (
    packages.agentfootprint.version !== '14.1.1' ||
    packages.agentfootprint.resolved !==
      'https://registry.npmjs.org/agentfootprint/-/agentfootprint-14.1.1.tgz'
  )
    throw Error('Wrong historical writer');
  mkdirSync('out', { recursive: true });
  writeFileSync('out/time-reply-published-14.1.1-pause.json', payload);
  writeFileSync(
    'out/time-reply-published-14.1.1-manifest.json',
    JSON.stringify(
      {
        kind: 'ACTUAL_PUBLISHED_NATIVE_WRITER',
        node: process.version,
        npm: process.env.npm_config_user_agent,
        packages,
        checkpointSHA256: hash(payload),
        lockSHA256: hash(readFileSync('package-lock.json')),
        writerSHA256: hash(readFileSync(new URL(import.meta.url))),
        message,
        clock,
        rangeField: field,
        toolEffects: completed,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await agent.shutdown();
}
