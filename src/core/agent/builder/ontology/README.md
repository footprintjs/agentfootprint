# Ontology configuration

`configure.ts` owns the existing frozen-map declaration check and optional always-on ask registration. It receives the original builder and keeps validation/access order. Behavior proof should cover ask validation before duplicate refusal, frozen-map checks and the none arm returning the same receiver without registering an instruction.
