/**
 * injection-engine — public re-export for the InjectionEngine subsystem.
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/context`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

export * from './lib/injection-engine/index.js';
