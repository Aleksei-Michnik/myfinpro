import { ACCOUNT_IMPORT_SOURCES } from '@myfinpro/shared';
import { CompanyTypes } from 'israeli-bank-scrapers/lib/definitions.js';
import { describe, expect, it } from 'vitest';
import {
  companyName,
  importSourceFor,
  isCompanyId,
  listCompanies,
  loginFieldsFor,
  requireCompanyId,
  COMPANY_IDS,
  DEFAULT_IMPORT_SOURCE,
} from './companies.js';
import { EXIT_USAGE } from './errors.js';

describe('the installed library', () => {
  it('declares the login fields, so this package never hand-maintains them', () => {
    expect(loginFieldsFor(CompanyTypes.isracard)).toEqual(['id', 'card6Digits', 'password']);
    expect(loginFieldsFor(CompanyTypes.hapoalim)).toEqual(['userCode', 'password']);
    expect(loginFieldsFor(CompanyTypes.discount)).toEqual(['id', 'password', 'num']);
  });

  it('names every company it can scrape', () => {
    expect(COMPANY_IDS.length).toBeGreaterThan(10);
    expect(companyName(CompanyTypes.visaCal)).toBe('Visa Cal');
    expect(listCompanies()).toContain('visaCal — Visa Cal');
  });

  it('recognises its own ids only', () => {
    expect(isCompanyId('hapoalim')).toBe(true);
    expect(isCompanyId('barclays')).toBe(false);
    expect(requireCompanyId('max')).toBe(CompanyTypes.max);
    expect(() => requireCompanyId('barclays')).toThrowError(
      expect.objectContaining({ exitCode: EXIT_USAGE }),
    );
  });
});

describe('importSourceFor', () => {
  it('maps the eight institutions the import contract names', () => {
    expect(importSourceFor(CompanyTypes.hapoalim)).toBe('hapoalim');
    expect(importSourceFor(CompanyTypes.leumi)).toBe('leumi');
    expect(importSourceFor(CompanyTypes.discount)).toBe('discount');
    expect(importSourceFor(CompanyTypes.mizrahi)).toBe('mizrahi');
    expect(importSourceFor(CompanyTypes.isracard)).toBe('isracard');
    expect(importSourceFor(CompanyTypes.visaCal)).toBe('cal');
    expect(importSourceFor(CompanyTypes.max)).toBe('max');
    expect(importSourceFor(CompanyTypes.amex)).toBe('amex');
  });

  it('files everything else under connector', () => {
    expect(importSourceFor(CompanyTypes.mercantile)).toBe(DEFAULT_IMPORT_SOURCE);
    expect(importSourceFor(CompanyTypes.oneZero)).toBe('connector');
    expect(importSourceFor('a company that does not exist')).toBe('connector');
  });

  it('only ever returns a source the API accepts', () => {
    for (const id of COMPANY_IDS) {
      expect(ACCOUNT_IMPORT_SOURCES).toContain(importSourceFor(id));
    }
  });
});
