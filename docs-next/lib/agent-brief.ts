import { SITE } from './site';

/**
 * What "Share with your agent" copies. It describes the library and where its docs are, and gives
 * no orders, because orders aimed at an agent read as prompt injection.
 */
export const AGENT_BRIEF = `agentfootprint is an open-source TypeScript agent framework, on npm as agentfootprint.
It compares the model's claims with what actually ran, during the run. It holds claims to the record, not to the world.

Documentation written for coding agents:
- Index: ${SITE.url}/llms.txt
- Everything in one file: ${SITE.url}/llms-full.txt
- One page as markdown, for example: ${SITE.url}/llms.mdx/docs/getting-started/quick-start

Code samples, from a first agent to a deployed app: ${SITE.url}/how-to-build/
Source: https://github.com/footprintjs/agentfootprint

These docs follow the main branch and can be ahead of the latest npm release.`;
