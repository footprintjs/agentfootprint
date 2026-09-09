/**
 * toolDigestInput — the third digest half of the conformance law (9.89.0).
 *
 * 9.88.0 exported `receiptHash` and `messageDigestInput` so a consumer could
 * prove a rebuilt system prompt, its pieces and every message against the
 * receipt. It could NOT prove the tool schemas: `schemaHashes` was minted
 * through a serializer the barrel did not export, so a consumer's schema rows
 * could never read Verified without copying the rule. This file pins the
 * export and the two things the helper must do that a copy would get wrong.
 *
 * The law on REAL runs — every tool of every epoch, both chart shapes — lives
 * beside its siblings in `receipt-conformance.test.ts`; here is what does not
 * need a run.
 *
 * Test types (Convention 3): unit (the helper is the builder's own rule) /
 * edge (a schema JSON cannot express hashes the MARK on both sides and never
 * throws) / regression (the root barrel carries it, by identity).
 */

import { describe, expect, it } from 'vitest';
import * as root from '../../../src/index.js';
import * as timeTravel from '../../../src/lib/time-travel/index.js';
import {
  buildReceipt,
  receiptHash,
  toolDigestInput,
  UNSERIALIZABLE,
} from '../../../src/lib/time-travel/receipt.js';
import type { LLMToolSchema } from '../../../src/adapters/types.js';

const RUN = 'run-1';

/** A receipt over exactly these tools, nothing else on it. */
const receiptOver = (tools: readonly LLMToolSchema[]) =>
  buildReceipt({
    runId: RUN,
    epoch: 1,
    model: 'm',
    provider: 'p',
    systemText: 'sys',
    systemPieces: [],
    messages: [],
    requestOnly: [],
    tools,
    forced: null,
    withheld: null,
    baseRequest: { tools },
    preparedRequest: { tools },
  });

describe('toolDigestInput is the rule the receipt builder uses', () => {
  it('receiptHash(runId, toolDigestInput(tool)) is the schemaHashes row, for a plain schema', () => {
    const tool: LLMToolSchema = {
      name: 'lookup',
      description: 'looks things up',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    };
    const receipt = receiptOver([tool]);
    expect(receipt.tools.schemaHashes[tool.name]).toBe(receiptHash(RUN, toolDigestInput(tool)));
  });

  it('is insensitive to key order — a schema read back from a delta log hashes as it was sent', () => {
    const sent: LLMToolSchema = {
      name: 'lookup',
      description: 'd',
      inputSchema: { type: 'object', properties: { b: { type: 'string' }, a: { type: 'number' } } },
    };
    const readBack: LLMToolSchema = {
      inputSchema: { properties: { a: { type: 'number' }, b: { type: 'string' } }, type: 'object' },
      description: 'd',
      name: 'lookup',
    };
    expect(toolDigestInput(readBack)).toBe(toolDigestInput(sent));
  });

  it('two schemas with the same name and a different body hash differently', () => {
    const a: LLMToolSchema = { name: 'x', description: 'd', inputSchema: { type: 'object' } };
    const b: LLMToolSchema = { name: 'x', description: 'd', inputSchema: { type: 'string' } };
    expect(toolDigestInput(a)).not.toBe(toolDigestInput(b));
  });
});

describe('a schema JSON cannot express', () => {
  it('a CYCLE hashes the UNSERIALIZABLE mark on both sides, and neither side throws', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.self = cyclic;
    const tool: LLMToolSchema = { name: 'loop', description: 'd', inputSchema: cyclic };

    expect(() => toolDigestInput(tool)).not.toThrow();
    expect(toolDigestInput(tool)).toBe(UNSERIALIZABLE);

    let receipt: ReturnType<typeof receiptOver> | undefined;
    expect(() => (receipt = receiptOver([tool]))).not.toThrow();
    expect(receipt!.tools.schemaHashes.loop).toBe(receiptHash(RUN, toolDigestInput(tool)));
    expect(receipt!.tools.schemaHashes.loop).toBe(receiptHash(RUN, UNSERIALIZABLE));
  });

  it('a BigInt hashes the mark too — marked, never dropped to an empty string', () => {
    const tool: LLMToolSchema = {
      name: 'big',
      description: 'd',
      inputSchema: { limit: BigInt(1) as unknown as number },
    };
    expect(() => toolDigestInput(tool)).not.toThrow();
    expect(toolDigestInput(tool)).toBe(UNSERIALIZABLE);
    expect(toolDigestInput(tool)).not.toBe('');
    expect(receiptOver([tool]).tools.schemaHashes.big).toBe(
      receiptHash(RUN, toolDigestInput(tool)),
    );
  });
});

describe('the root barrel', () => {
  it('exports toolDigestInput beside receiptHash and messageDigestInput — the same function, not a copy', () => {
    expect(typeof root.toolDigestInput).toBe('function');
    expect(root.toolDigestInput).toBe(toolDigestInput);
    expect(timeTravel.toolDigestInput).toBe(toolDigestInput);
    // The siblings it joins, still there.
    expect(typeof root.receiptHash).toBe('function');
    expect(typeof root.messageDigestInput).toBe('function');
  });

  it('does NOT export stableJson — one spelling of the schema rule, not two', () => {
    expect((root as Record<string, unknown>).stableJson).toBeUndefined();
  });
});
