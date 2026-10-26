/** Small fixture data only: importing this file never loads the agent runtime. */
export type RefundStatus = 'completed' | 'pending';

export interface RefundEvidence {
  readonly customerId: string;
  readonly orderId: string;
  readonly status: RefundStatus;
  readonly readAt: string;
}

export interface AnswerCheckFixture {
  readonly id: string;
  readonly label: string;
  readonly explanation: string;
  readonly evidence: RefundEvidence | null;
  readonly draft: RefundEvidence;
}

export const ANSWER_CHECK_REQUEST = {
  customerId: 'customer-42',
  orderId: 'A-1042',
  now: '2026-01-15T12:02:00Z',
  maxAgeMs: 5 * 60 * 1000,
} as const;

export const ANSWER_CHECK_GAP = 'Bank settlement was not checked.';

const completed: RefundEvidence = {
  customerId: ANSWER_CHECK_REQUEST.customerId,
  orderId: ANSWER_CHECK_REQUEST.orderId,
  status: 'completed',
  readAt: '2026-01-15T12:00:00Z',
};

export const ANSWER_CHECK_FIXTURES: readonly AnswerCheckFixture[] = [
  {
    id: 'supported',
    label: 'Evidence agrees',
    explanation: 'The draft matches a recent lookup for this customer and order.',
    evidence: completed,
    draft: completed,
  },
  {
    id: 'missing',
    label: 'Evidence missing',
    explanation: 'The lookup failed. The same confident draft has nothing to support it.',
    evidence: null,
    draft: completed,
  },
  {
    id: 'contradictory',
    label: 'Evidence contradicts',
    explanation: 'The draft says completed, but the ledger still says pending.',
    evidence: { ...completed, status: 'pending' },
    draft: completed,
  },
];
