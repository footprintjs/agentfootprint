/** Closed documented action carriers and public labels; arbitrary names/matches are never labels. */
export interface ActionCarrier {
  readonly family: string;
  readonly labels?: ReadonlySet<string>;
  readonly masks: boolean;
  readonly fields: ReadonlySet<string>;
}

const piiTypes = new Set([
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
]);

export const CARRIERS: Readonly<Record<string, ActionCarrier>> = {
  piiEntities: {
    family: 'pii',
    labels: piiTypes,
    masks: true,
    fields: new Set(['action', 'type', 'match', 'detected']),
  },
  regexes: {
    family: 'regex',
    masks: true,
    fields: new Set(['action', 'name', 'match', 'regex', 'detected']),
  },
  contentFilters: {
    family: 'content',
    labels: new Set(['INSULTS', 'HATE', 'SEXUAL', 'VIOLENCE', 'MISCONDUCT', 'PROMPT_ATTACK']),
    masks: false,
    fields: new Set(['action', 'type', 'confidence', 'filterStrength', 'detected']),
  },
  topics: {
    family: 'topic',
    labels: new Set(['DENY']),
    masks: false,
    fields: new Set(['action', 'type', 'name', 'detected']),
  },
  customWords: {
    family: 'custom-word',
    masks: false,
    fields: new Set(['action', 'match', 'detected']),
  },
  managedWordLists: {
    family: 'managed-word',
    labels: new Set(['PROFANITY']),
    masks: false,
    fields: new Set(['action', 'type', 'match', 'detected']),
  },
  groundingFilters: {
    family: 'contextual-grounding',
    labels: new Set(['GROUNDING', 'RELEVANCE']),
    masks: false,
    fields: new Set(['action', 'type', 'score', 'threshold', 'detected']),
  },
};

export const POLICIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sensitiveInformationPolicy: { piiEntities: 'piiEntities', regexes: 'regexes' },
  contentPolicy: { filters: 'contentFilters' },
  topicPolicy: { topics: 'topics' },
  wordPolicy: { customWords: 'customWords', managedWordLists: 'managedWordLists' },
  contextualGroundingPolicy: { filters: 'groundingFilters' },
};

export const ASSESSMENT_METADATA = new Set(['invocationMetrics', 'appliedGuardrailDetails']);
/** Converse and ConverseStream root trace siblings; router contents stay private and unread. */
export const RESPONSE_TRACE_FIELDS = new Set(['guardrail', 'promptRouter']);
export const TRACE_FIELDS = new Set([
  'inputAssessment',
  'outputAssessments',
  'modelOutput',
  'actionReason',
]);
