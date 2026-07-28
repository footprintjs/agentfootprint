/**
 * Event tap for the docs-truth reference runs. Preloaded with `tsx --import`.
 *
 * Records every event that reaches the EventDispatcher during an example run,
 * so the EXERCISED column rests on observed behaviour rather than on a guess.
 *
 * Two details make this work:
 *
 *   1. `createRequire`, not `import`. tsx loads the examples through the CJS
 *      registry; an ESM `import` of the same file yields a SECOND module
 *      instance, and patching that one records nothing. Requiring the `.ts`
 *      file reaches the very object the example under test will use.
 *   2. `hasListenersFor` is forced to `true`. Emitters skip event allocation
 *      when nothing is subscribed (EmitBridge early-exits, see
 *      src/recorders/core/EmitBridge.ts), so with no listener attached an event
 *      would never reach `dispatch()` at all. Forcing the gate open makes the
 *      run report what it WOULD emit to a subscriber.
 *
 * Honest limit: an event emitted only through a recorder that a given run never
 * attaches is not observed here. The check reports such events as UNKNOWN — not
 * as absent.
 *
 * Writes one `<eventType>` per line to $AF_DOCS_TRUTH_EVENTS. Never throws into
 * the run: a broken tap must not fail an example.
 */
import { appendFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const ROOT = process.env.AF_DOCS_TRUTH_ROOT;
const OUT = process.env.AF_DOCS_TRUTH_EVENTS;

if (ROOT && OUT) {
  const require = nodeModule.createRequire(`${ROOT}/package.json`);
  try {
    const mod = require(`${ROOT}/src/events/dispatcher.ts`);
    const Dispatcher = mod?.EventDispatcher;
    if (typeof Dispatcher === 'function') {
      const originalDispatch = Dispatcher.prototype.dispatch;
      Dispatcher.prototype.hasListenersFor = function () {
        return true;
      };
      Dispatcher.prototype.dispatch = function (event) {
        try {
          if (event && typeof event.type === 'string') appendFileSync(OUT, `${event.type}\n`);
        } catch {
          /* never break the run over telemetry */
        }
        return originalDispatch.call(this, event);
      };
    } else {
      appendFileSync(OUT, '__TAP_FAILED__ EventDispatcher not found\n');
    }
  } catch (err) {
    appendFileSync(OUT, `__TAP_FAILED__ ${err.message}\n`);
  }
}
