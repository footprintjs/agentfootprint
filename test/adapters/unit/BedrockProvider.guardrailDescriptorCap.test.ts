import { describe, expect, it } from 'vitest';
import { modes, pair, publicText, read, trace } from './bedrockGuardrailFixtures.js';

// These wire fixtures are pinned from AWS's public contract, never imported
// from the classifier. AWS lists 31 PII types; content actions cannot mask.
// https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_GuardrailPiiEntityFilter.html
// https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_GuardrailContentFilter.html
const PII_TYPES = [
  'ADDRESS',
  'AGE',
  'AWS_ACCESS_KEY',
  'AWS_SECRET_KEY',
  'CA_HEALTH_NUMBER',
  'CA_SOCIAL_INSURANCE_NUMBER',
  'CREDIT_DEBIT_CARD_CVV',
  'CREDIT_DEBIT_CARD_EXPIRY',
  'CREDIT_DEBIT_CARD_NUMBER',
  'DRIVER_ID',
  'EMAIL',
  'INTERNATIONAL_BANK_ACCOUNT_NUMBER',
  'IP_ADDRESS',
  'LICENSE_PLATE',
  'MAC_ADDRESS',
  'NAME',
  'PASSWORD',
  'PHONE',
  'PIN',
  'SWIFT_CODE',
  'UK_NATIONAL_HEALTH_SERVICE_NUMBER',
  'UK_NATIONAL_INSURANCE_NUMBER',
  'UK_UNIQUE_TAXPAYER_REFERENCE_NUMBER',
  'URL',
  'USERNAME',
  'US_BANK_ACCOUNT_NUMBER',
  'US_BANK_ROUTING_NUMBER',
  'US_INDIVIDUAL_TAX_IDENTIFICATION_NUMBER',
  'US_PASSPORT_NUMBER',
  'US_SOCIAL_SECURITY_NUMBER',
  'VEHICLE_IDENTIFICATION_NUMBER',
] as const;

function masks(privateValue = 'PRIVATE_CAP_LEFT') {
  return {
    sensitiveInformationPolicy: {
      piiEntities: PII_TYPES.map((type) => ({
        type,
        action: 'ANONYMIZED',
        detected: true,
        match: privateValue,
      })),
      // The 32nd distinct public descriptor is the generic regex family.
      // Its name and match are private; neither is a public type label.
      // https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_GuardrailRegexFilter.html
      regexes: [
        {
          action: 'ANONYMIZED',
          detected: true,
          name: privateValue,
          match: privateValue,
          regex: privateValue,
        },
      ],
    },
  };
}

function block() {
  return {
    contentPolicy: {
      filters: [
        {
          type: 'HATE',
          action: 'BLOCKED',
          confidence: 'HIGH',
          detected: true,
        },
      ],
    },
  };
}

function descriptorKeys(filters: readonly { family: string; type?: string }[]) {
  return filters.map((filter) => `${filter.family}:${filter.type ?? ''}`);
}

for (const mode of modes) {
  describe(`Bedrock guardrails actual descriptor saturation — ${mode}`, () => {
    it('first establishes 32 distinct masking descriptors with no block', async () => {
      expect(PII_TYPES).toHaveLength(31);
      expect(new Set(PII_TYPES).size).toBe(31);
      const fx = pair(trace(masks()));
      const { result } = await read(fx.provider, mode);
      expect(result.intervention?.outcome).toBe('masked');
      expect(result.intervention?.filters).toHaveLength(32);
      expect(new Set(descriptorKeys(result.intervention?.filters ?? [])).size).toBe(32);
      expect(result.intervention?.filters).toEqual(
        expect.arrayContaining([
          ...PII_TYPES.map((type) => ({ family: 'pii', type })),
          { family: 'regex' },
        ]),
      );
      expect(result.content).toBe(publicText);
      expect(fx.send).toHaveBeenCalledTimes(1);
    });

    for (const position of ['early', 'late'] as const) {
      it(`a ${position} block remains proved when actual emission reaches 32`, async () => {
        const fx = pair(position === 'late' ? trace(masks(), block()) : trace(block(), masks()));
        const { result, chunks } = await read(fx.provider, mode);
        expect(result.intervention?.outcome).toBe('blocked');
        expect(result.intervention?.filters).toHaveLength(32);
        expect(new Set(descriptorKeys(result.intervention?.filters ?? [])).size).toBe(32);
        expect(result.content).toBe('');
        expect(result.toolCalls).toEqual([]);
        expect(chunks.filter((chunk) => !chunk.done)).toEqual([]);
        expect(JSON.stringify(result)).not.toContain('PRIVATE_CAP_LEFT');
        expect(fx.send).toHaveBeenCalledTimes(1);
      });
    }

    it('private regex names, patterns and matched values do not change public cap bytes', async () => {
      const left = pair(trace(masks('PRIVATE_CAP_LEFT'), block()));
      const right = pair(trace(masks('PRIVATE_CAP_RIGHT_WITH_DIFFERENT_LENGTH'), block()));
      const first = await read(left.provider, mode);
      const second = await read(right.provider, mode);
      expect(first.result.intervention?.outcome).toBe('blocked');
      expect(first.result.intervention?.filters).toHaveLength(32);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(JSON.stringify(first)).not.toContain('PRIVATE_CAP_');
      expect(left.send).toHaveBeenCalledTimes(1);
      expect(right.send).toHaveBeenCalledTimes(1);
    });
  });
}
