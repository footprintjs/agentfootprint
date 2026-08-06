/**
 * Compile-level regression test — the 8.0.0 doors carry the same TYPES the
 * deprecated aliases did, and `Watcher` accepts what `.watch()` is for.
 *
 * `test/api-conformance/door-aliases.test.ts` proves alias↔door sameness by
 * driving the TypeScript checker over the SHIPPED `.d.ts` files. That is the
 * broad, mechanical sweep. This file is the narrow, human-written half: the
 * REAL compiler (`npm run test:types`) checking the handful of assignments a
 * consumer actually writes, in the direction they actually write them.
 *
 * Two things it pins that a name-by-name sweep cannot:
 *
 *   1. `CircuitState` is genuinely ONE type across `/resilience` and the
 *      deprecated `/reliability`. Two files declare it; if either ever drifts,
 *      these assignments stop compiling. That is what makes it honest to call
 *      it a "structural twin" in the door-alias exception list rather than a
 *      collision we papered over.
 *
 *   2. `Watcher` — the plain name `.watch()` takes — really does accept every
 *      shape a consumer hands it: a recorder factory's handle, a bare object
 *      with hook methods, and footprintjs's own `CombinedRecorder`.
 *
 * Lives under its own tsconfig (`npm run test:types`) so the compiler checks
 * the assignments, while the `.test.ts` name lets vitest run the assertions.
 */
import { describe, expect, it } from 'vitest';

import { Agent, type Watcher, type CombinedRecorder } from '../../src/index';
import { toolChoiceRecorder, routeRecorder } from '../../src/doors/observe';
import { mock, staticEmbedder } from '../../src/doors/providers';

// The two paths that declare CircuitState.
import type { CircuitState as StateFromDoor } from '../../src/doors/resilience';
import type { CircuitState as StateFromAlias } from '../../src/reliability/index';
// And the one name that deliberately does NOT move.
import { CircuitOpenError as GateError } from '../../src/reliability/index';
import { CircuitOpenError as DecoratorError } from '../../src/doors/resilience';

describe('CircuitState is one type, wearing two declarations', () => {
  it('assigns in both directions without a cast', () => {
    // If either declaration drifts, ONE of these four lines stops compiling —
    // which is the whole reason it is safe to call them twins.
    const openFromAlias: StateFromAlias = 'open';
    const openFromDoor: StateFromDoor = openFromAlias;
    const backToAlias: StateFromAlias = openFromDoor;
    const halfOpen: StateFromDoor = 'half-open';

    expect([openFromAlias, openFromDoor, backToAlias, halfOpen]).toEqual([
      'open',
      'open',
      'open',
      'half-open',
    ]);
  });

  it('covers the whole union on both paths', () => {
    const all: StateFromDoor[] = ['closed', 'open', 'half-open'];
    const mirrored: StateFromAlias[] = all;
    expect(mirrored).toHaveLength(3);
  });
});

describe('CircuitOpenError is TWO classes — the fact behind the pinned exception', () => {
  it('instanceof does not cross between them', () => {
    const fromGate = new GateError('anthropic', 'boom', Date.now() + 1000);
    const fromDecorator = new DecoratorError('anthropic', new Error('boom'), Date.now() + 1000);

    // Both are real errors with the same shape of information...
    expect(fromGate.code).toBe('ERR_CIRCUIT_OPEN');
    expect(fromDecorator.code).toBe('ERR_CIRCUIT_OPEN');
    expect(fromGate.name).toBe('CircuitOpenError');

    // ...and they are still not the same class. A consumer who catches the
    // reliability gate's error must keep importing it from the deprecated
    // `agentfootprint/reliability`, which is why the door cannot carry it.
    expect(fromGate).not.toBeInstanceOf(DecoratorError);
    expect(fromDecorator).not.toBeInstanceOf(GateError);
  });
});

describe('Watcher accepts everything .watch() is meant to take', () => {
  it('a recorder factory handle — including ones reached only through the new doors', () => {
    // `toolChoiceRecorder` comes from /observe by way of the old /observe
    // barrel; `staticEmbedder` from /providers by way of the old /embedders.
    // Two folded aliases meeting at one call site is the point of the doors.
    const fromFactory: Watcher = toolChoiceRecorder({ embedder: staticEmbedder() });
    const alsoFromFactory: Watcher = routeRecorder();
    expect(fromFactory.id).toBeTypeOf('string');
    expect(alsoFromFactory.id).toBeTypeOf('string');
  });

  it('a bare object with hook methods', () => {
    const handRolled: Watcher = {
      id: 'hand-rolled',
      onEmit: () => {
        /* noop */
      },
    };
    expect(handRolled.id).toBe('hand-rolled');
  });

  it('is the same type as the substrate CombinedRecorder, not a narrowing of it', () => {
    const asCombined: CombinedRecorder = { id: 'x' };
    const asWatcher: Watcher = asCombined;
    const backAgain: CombinedRecorder = asWatcher;
    expect(backAgain.id).toBe('x');
  });

  it('flows through .watch() at the real call site, variadically', async () => {
    const observers: Watcher[] = [
      toolChoiceRecorder({ embedder: staticEmbedder() }),
      routeRecorder(),
    ];
    const agent = Agent.create({
      provider: mock({ respond: () => ({ content: 'ok', toolCalls: [] }) }),
      model: 'mock',
    })
      .system('s')
      .watch(...observers)
      .watch({ id: 'inline', onEmit: () => undefined })
      .build();

    const out = await agent.run({ message: 'go' });
    expect(out).toBeDefined();
  });
});
