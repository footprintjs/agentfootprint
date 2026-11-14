**Mixed** — assembles the configured agent and its served setup.
Map: `contracts.ts`, `deferred.ts`, `steps.ts` and `build.ts` validate and wire declarations.
Lens: `build.ts` and `steps.ts` select the declared instructions and model-facing guidance.

# Agent assembly

Runs the original whole-agent checks in order, then calls the facade constructor
with its existing local values and attaches observers and self-explanation.
Contracts, stepped skills, and deferred skill checks each own one ordered unit.
The live port reads the actual builder; callbacks retain its receiver.
