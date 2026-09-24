import type { AccountKind } from '../types/account.types';

/**
 * Phase 20 — the closed list of institutions an account can belong to, and
 * their metadata. See docs/phase-20-accounts-design.md §4.1.
 *
 * Closed list, not free text: the value is persisted on `accounts.institution`
 * (VarChar(20)), drives the kind narrowing in the account form, and keys the
 * bill tokens the transfer proposal (§5.3) looks for.
 */
export const ACCOUNT_INSTITUTIONS = [
  /* Israeli banks */
  'hapoalim',
  'leumi',
  'discount',
  'mizrahi',
  'beinleumi',
  'yahav',
  'otsar',
  'mercantile',
  'onezero',
  /* card issuers */
  'isracard',
  'cal',
  'max',
  'amex',
  'other',
] as const;
export type AccountInstitution = (typeof ACCOUNT_INSTITUTIONS)[number];

export interface InstitutionMeta {
  /** English display name; the web translates it when a locale key exists. */
  name: string;
  /** Account kinds this institution issues — the form narrows on it, and the
   *  API rejects an account whose `kind` is not in this list. */
  kinds: AccountKind[];
  /**
   * Description tokens that identify this issuer's monthly bill on a bank
   * statement, used by the transfer proposal (design §5.3). Matched
   * case-insensitively as substrings of a line's normalized description, so
   * both the Hebrew and the Latin spelling are listed. Best-effort data:
   * the list grows as real statements are seen, and a miss degrades to a
   * `create` suggestion — never to a wrong transfer.
   */
  billTokens?: string[];
}

export const INSTITUTION_META: Record<AccountInstitution, InstitutionMeta> = {
  hapoalim: { name: 'Bank Hapoalim', kinds: ['BANK'] },
  leumi: { name: 'Bank Leumi', kinds: ['BANK'] },
  discount: { name: 'Israel Discount Bank', kinds: ['BANK'] },
  mizrahi: { name: 'Mizrahi Tefahot Bank', kinds: ['BANK'] },
  beinleumi: { name: 'First International Bank of Israel', kinds: ['BANK'] },
  yahav: { name: 'Bank Yahav', kinds: ['BANK'] },
  otsar: { name: 'Bank Otsar Ha-Hayal', kinds: ['BANK'] },
  mercantile: { name: 'Mercantile Discount Bank', kinds: ['BANK'] },
  onezero: { name: 'One Zero', kinds: ['BANK'] },
  isracard: {
    name: 'Isracard',
    kinds: ['CARD'],
    billTokens: ['ישראכרט', 'ישרא כרט', 'ISRACARD'],
  },
  cal: {
    name: 'Visa Cal',
    kinds: ['CARD'],
    billTokens: ['כאל', 'כ.א.ל', 'ויזה כאל', 'CAL', 'VISA CAL'],
  },
  max: {
    name: 'Max',
    kinds: ['CARD'],
    // "לאומי קארד" is Max's former name and still prints on older statements.
    billTokens: ['מקס', 'מקס איט', 'לאומי קארד', 'MAX', 'LEUMI CARD'],
  },
  amex: {
    name: 'American Express',
    kinds: ['CARD'],
    billTokens: ['אמריקן אקספרס', 'אמקס', 'AMEX', 'AMERICAN EXPRESS'],
  },
  /** Escape hatch — any institution not listed above, and cash wallets. */
  other: { name: 'Other', kinds: ['BANK', 'CARD', 'CASH', 'OTHER'] },
};
