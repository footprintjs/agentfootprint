# claim — a value that says how it knows itself

**Where it lives.** `src/lib/claim/` — one vocabulary leaf, many doors. It is re-exported
reference-equal from both `agentfootprint/maps` and `agentfootprint/cache`, so `known` imported
from either door is the same function.

**Why.** Three recorded failures came from the system stating a value it did not hold: a final
summary written from a trimmed memory, a served list whose silent cap read as completeness, and
(9.58.0) a cache meter that reported a 0% hit rate for a turn nobody had measured. `Claim<T>` makes the third state — *we do not know, and here is why* — a first-class
value a consumer must branch on. An unknown count can never become a zero, because the type has no
door from `unknown` to `.value`.

**What.** A tagged union with three arms and their constructors:

- `known(value, evidence)` — a value with the one sentence that backs it.
- `unknown(reason, evidence?)` — an absence with its mandatory reason.
- `notApplicable(evidence)` — the question does not apply to this subject.

Plus `isKnown` (the only door to `.value`), `valueOr(claim, fallback)` (the fallback is a required
argument — a silent `undefined` default would put the shrug back), and `describeClaim` (one plain
sentence for a record or a prompt).

**Runnable example.**

```ts
import { known, unknown, isKnown, describeClaim } from 'agentfootprint/maps';

const total = known(11, 'the app declared total on the choices block');
const cacheRead = unknown<number>('the provider reported no cache fields', 'usage payload');

if (isKnown(total)) console.log(total.value); // 11
console.log(describeClaim(cacheRead)); // "unknown — the provider reported no cache fields"
```

Everything here is a plain object — it survives `structuredClone`, so Claims can ride chart
state, event payloads, and recordings unchanged.
