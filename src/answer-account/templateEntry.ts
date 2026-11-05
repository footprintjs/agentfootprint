/** One entry of the answer account's closed table of words (`templates.ts`). */

export type TemplateVoucher = 'person' | 'library' | 'tool' | 'model' | 'app';

export interface AccountTemplate {
  readonly version: number;
  readonly text: string;
  readonly voucher: TemplateVoucher;
}

export const t = (
  text: string,
  voucher: TemplateVoucher = 'library',
  version = 1,
): AccountTemplate => Object.freeze({ version, text, voucher });
