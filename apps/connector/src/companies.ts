// Phase 20 · Iteration 20.7 — what the scraper library knows about a company.
//
// The login fields are READ from israeli-bank-scrapers (`SCRAPERS`), never
// hand-maintained here: a bank that starts asking for another field then costs
// a library upgrade, not a patch. `definitions` and `transactions` are the
// library's two dependency-free modules, so importing them costs nothing —
// puppeteer is loaded only when a scrape actually runs (see scrape.ts).

import { ACCOUNT_IMPORT_SOURCES, type AccountImportSource } from '@myfinpro/shared';
import { CompanyTypes, SCRAPERS } from 'israeli-bank-scrapers/lib/definitions.js';
import { usageError } from './errors.js';

/** The library's own company enum — what `createScraper` takes. */
export type CompanyId = CompanyTypes;

/** Every company the installed library can scrape, in its own order. */
export const COMPANY_IDS = Object.keys(SCRAPERS) as CompanyId[];

export function isCompanyId(value: string): value is CompanyId {
  return Object.prototype.hasOwnProperty.call(SCRAPERS, value);
}

export function requireCompanyId(value: string): CompanyId {
  if (!isCompanyId(value)) {
    throw usageError(`"${value}" is not a company this library scrapes.`, listCompanies());
  }
  return value;
}

/** The library's display name, e.g. `visaCal` → "Visa Cal". */
export function companyName(id: CompanyId): string {
  return SCRAPERS[id].name;
}

/** `id`, `password`, `card6Digits`, `num`, … — exactly as the library asks. */
export function loginFieldsFor(id: CompanyId): string[] {
  return [...SCRAPERS[id].loginFields];
}

/**
 * A callback the user cannot type. OneZero's interactive OTP retriever is the
 * only one; its long-term token is the field a non-interactive run needs.
 */
export const UNPROMPTABLE_LOGIN_FIELDS = new Set(['otpCodeRetriever']);

/** Fields whose value must never be echoed while it is being typed. */
export const SECRET_LOGIN_FIELDS = new Set(['password', 'otpLongTermToken']);

/** Alternatives — a profile is usable with only one of them filled in. */
export const OPTIONAL_LOGIN_FIELDS = new Set(['phoneNumber', 'otpLongTermToken']);

/**
 * `source` of the import a company's lines land in (design §6.2). The eight
 * institutions `ACCOUNT_IMPORT_SOURCES` names keep their own id, so a
 * connector import is filed exactly like the same bank's file import;
 * everything else is `connector`.
 */
const COMPANY_IMPORT_SOURCES: Partial<Record<CompanyId, AccountImportSource>> = {
  [CompanyTypes.hapoalim]: 'hapoalim',
  [CompanyTypes.leumi]: 'leumi',
  [CompanyTypes.discount]: 'discount',
  [CompanyTypes.mizrahi]: 'mizrahi',
  [CompanyTypes.isracard]: 'isracard',
  [CompanyTypes.visaCal]: 'cal',
  [CompanyTypes.max]: 'max',
  [CompanyTypes.amex]: 'amex',
};

/** The fallback every other company maps onto. */
export const DEFAULT_IMPORT_SOURCE: AccountImportSource = 'connector';

export function importSourceFor(id: string): AccountImportSource {
  const source = COMPANY_IMPORT_SOURCES[id as CompanyId];
  return source && ACCOUNT_IMPORT_SOURCES.includes(source) ? source : DEFAULT_IMPORT_SOURCE;
}

/** Printable list for `init` and for a "no such company" message. */
export function listCompanies(): string {
  return COMPANY_IDS.map((id) => `  ${id} — ${companyName(id)}`).join('\n');
}
