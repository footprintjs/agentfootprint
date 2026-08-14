/**
 * devWarnHost — agentfootprint's binding of the pure core's dev-warn seam
 * (9.34.0). Side-effect module: importing it is the whole API.
 *
 * The injection-engine barrel imports this for its side effect, so every
 * path that can reach `skillGraph()` inside this package (the main entry,
 * `agentfootprint/context`) has bound the reader before a graph exists.
 * `agentfootprint/skill-graph` deliberately does NOT import it — that door
 * loads no engine, and this file's one job is to read footprintjs's flag.
 *
 * Zone: HOST. It is the only place in the injection engine that may import
 * `footprintjs`, and it exists so the other files do not have to.
 *
 * Listed in package.json `sideEffects` so a bundler keeps it.
 */

import { isDevMode } from 'footprintjs';

import { useSkillGraphDevMode } from './devWarn.js';

useSkillGraphDevMode(isDevMode);
