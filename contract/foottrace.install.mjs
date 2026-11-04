import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

/** Contract-only: both consumers must resolve the same physical record image. */
export function assertSingleFoottrace(from = new URL('../package.json', import.meta.url)) {
  const consumer = createRequire(from);
  const engine = createRequire(consumer.resolve('footprintjs'));
  const root = realpathSync(consumer.resolve('foottrace'));
  const footprintjs = realpathSync(engine.resolve('foottrace'));
  assert.equal(
    root,
    footprintjs,
    'agentfootprint and footprintjs must share one physically installed Foottrace image',
  );
  return { root, footprintjs };
}
