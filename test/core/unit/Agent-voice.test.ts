/**
 * Agent voice config — `.appName()` / `.commentaryTemplates()` /
 * `.thinkingTemplates()` builder methods + runner getters.
 *
 * 5 patterns covering the contract every viewer (Lens, ChatThinkKit,
 * CLI tail) reads from:
 *
 *   V1  Defaults:               appName='Chatbot', bundled templates
 *   V2  appName() override:     reflected on the runner instance
 *   V3  commentaryTemplates():  partial override merged with defaults
 *   V4  thinkingTemplates():    partial override + per-tool key
 *   V5  Compose-friendly:       chained builder calls accumulate
 *
 * These are the bindings consumers use to brand / localize / multi-
 * tenant their agents. Lock the contract so future refactors don't
 * silently drop a getter.
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  MockProvider,
  defaultCommentaryTemplates,
  defaultThinkingTemplates,
} from '../../../src/index.js';

function mock() {
  return MockProvider.realistic({ thinkingMs: 0, chunkDelayMs: 0, reply: 'ok' });
}

// ── V1: defaults ──────────────────────────────────────────────────

describe('Agent voice — V1: defaults', () => {
  it('appName defaults to "Chatbot"', () => {
    const agent = Agent.create({ provider: mock(), model: 'm' }).system('').build();
    expect(agent.appName).toBe('Chatbot');
  });

  it('commentaryTemplates equals the bundled defaults when not overridden', () => {
    const agent = Agent.create({ provider: mock(), model: 'm' }).system('').build();
    expect(agent.commentaryTemplates).toEqual(defaultCommentaryTemplates);
  });

  it('thinkingTemplates equals the bundled defaults when not overridden', () => {
    const agent = Agent.create({ provider: mock(), model: 'm' }).system('').build();
    expect(agent.thinkingTemplates).toEqual(defaultThinkingTemplates);
  });
});

// ── V2: appName override ──────────────────────────────────────────

describe('Agent voice — V2: .appName()', () => {
  it('override is reflected on the runner', () => {
    const agent = Agent.create({ provider: mock(), model: 'm' })
      .system('')
      .appName('Acme Bot')
      .build();
    expect(agent.appName).toBe('Acme Bot');
  });
});

// ── V3: commentaryTemplates override ──────────────────────────────

describe('Agent voice — V3: .commentaryTemplates()', () => {
  it('partial override is merged on top of defaults; missing keys fall back', () => {
    const agent = Agent.create({ provider: mock(), model: 'm' })
      .system('')
      .commentaryTemplates({
        'agent.turn_start': 'Customer: "{{userPrompt}}"',
      })
      .build();
    // Overridden key wins.
    expect(agent.commentaryTemplates['agent.turn_start']).toBe(
      'Customer: "{{userPrompt}}"',
    );
    // Untouched keys still resolve from bundled defaults.
    expect(agent.commentaryTemplates['stream.tool_end']).toBe(
      defaultCommentaryTemplates['stream.tool_end'],
    );
  });
});

// ── V4: thinkingTemplates + per-tool key ──────────────────────────

describe('Agent voice — V4: .thinkingTemplates() with per-tool key', () => {
  it('per-tool override key (tool.<name>) is preserved on the runner', () => {
    const agent = Agent.create({ provider: mock(), model: 'm' })
      .system('')
      .thinkingTemplates({
        idle: 'Pondering…',
        'tool.weather': 'Looking up the weather…',
      })
      .build();
    expect(agent.thinkingTemplates.idle).toBe('Pondering…');
    expect(agent.thinkingTemplates['tool.weather']).toBe('Looking up the weather…');
    // Generic fallback key still present.
    expect(agent.thinkingTemplates.tool).toBe(defaultThinkingTemplates.tool);
  });
});

// ── V5: chained builder calls accumulate ──────────────────────────

describe('Agent voice — V5: chained calls accumulate', () => {
  it('multiple .commentaryTemplates() calls merge progressively', () => {
    const agent = Agent.create({ provider: mock(), model: 'm' })
      .system('')
      .commentaryTemplates({ 'agent.turn_start': 'A' })
      .commentaryTemplates({ 'stream.tool_end': 'B' })
      .build();
    expect(agent.commentaryTemplates['agent.turn_start']).toBe('A');
    expect(agent.commentaryTemplates['stream.tool_end']).toBe('B');
  });

  it('full voice swap: appName + commentary + thinking in one chain', () => {
    const agent = Agent.create({ provider: mock(), model: 'm' })
      .system('')
      .appName('Asistente')
      .commentaryTemplates({ 'agent.turn_start': 'El usuario preguntó: "{{userPrompt}}"' })
      .thinkingTemplates({ idle: 'Pensando…' })
      .build();
    expect(agent.appName).toBe('Asistente');
    expect(agent.commentaryTemplates['agent.turn_start']).toContain('El usuario');
    expect(agent.thinkingTemplates.idle).toBe('Pensando…');
  });
});
