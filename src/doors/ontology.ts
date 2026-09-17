/**
 * agentfootprint/ontology — a declared map of what exists and where, never a
 * way to fetch it.
 *
 * The owner's ruling: an ontology is like a map — it does not provide a way
 * to get data; it tells and reasons about each node and how to reach a
 * node, so a model that finds no data can say which node or source would
 * help further. Declared at build (`defineOntology`), validated against the
 * agent's tool registry at `.build()`, frozen, on the record as ONE
 * committed key (`AgentState.ontology`), served as ONE request-only system
 * piece composed by a pure function (`ontologyPiece`), hashed per receipt
 * and rebuilt byte-equal by `servedAt`. Never a runtime write, never a
 * tool, never a fetch path; the library infers nothing from it.
 *
 * @example
 * ```ts
 * import { defineOntology } from 'agentfootprint/ontology';
 *
 * const map = defineOntology({
 *   id: 'fleet',
 *   version: '1',
 *   sources: {
 *     inventory: { meaning: 'the switch inventory export', configured: true },
 *   },
 *   nodes: {
 *     port: { meaning: 'a physical switch port', sources: [{ source: 'inventory', via: ['lookup_port'] }] },
 *     port_error_rate: { meaning: 'CRC errors per minute on a port', unit: 'errors/min' },
 *   },
 *   edges: [{ from: 'port_error_rate', to: 'port', relation: 'measured-on' }],
 * });
 *
 * const agent = Agent.create({ provider, model }).tool(lookupPort).ontology(map).build();
 * ```
 */

export * from '../ontology/index.js';
