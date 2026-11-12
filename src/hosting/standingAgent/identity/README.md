**Support** — request actors and stored namespaces composed without a model surface.

# Request identity composition

`request.ts` composes a verified request actor with the stored conversation and
tenant, and normalizes transport headers without making repeated credentials
anonymous. It performs no verification or store access. Tests pin namespace
preservation and ambiguous authorization detection.
