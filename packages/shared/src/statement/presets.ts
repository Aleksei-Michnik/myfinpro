// Phase 20 · Iteration 20.4 — statement presets, as DATA.
//
// Every column list below is the verbatim Hebrew header set recorded in
// docs/notes/bank-sync-research-2026-09.md §3, which was compiled from public
// parsers written against real exports. No real statement was used and none
// is needed to extend this file: a new institution is a new entry, never a
// new code path (design §4.1). A preset that stops matching degrades to the
// manual column picker — never to a failed import (design §11).

import type { StatementPreset, StatementPresetId, StatementTitleInfo } from './types';
import { parseHebrewMonthYear, parseStatementDate } from './values';

/** `… ישראכרט - 0423` → `0423`. Only the last 4 digits ever leave the file. */
function extractLast4(titleText: string): StatementTitleInfo | null {
  for (const segment of titleText.split('|')) {
    const hit = /[-–]\s*(\d{4})\s*$/.exec(segment.trim());
    if (hit) return { last4: hit[1] };
  }
  return null;
}

/**
 * Card-cycle title rows: the billing month (`ספטמבר 2026`) gives the period,
 * `לחיוב ב-10.09` the day the bank is debited — which is the last day the
 * statement covers, so it lands on `periodTo`. A billing day that falls in
 * the month after the statement's (December → January) rolls the year.
 */
function extractBillingCycle(titleText: string): StatementTitleInfo | null {
  const monthYear = parseHebrewMonthYear(titleText);
  const charge = /לחיוב\s*ב[-־]?\s*(\d{1,2})[./](\d{1,2})/.exec(titleText);
  if (!monthYear && !charge) return null;

  const info: StatementTitleInfo = {};
  if (monthYear) {
    info.periodFrom = `${monthYear.year}-${String(monthYear.month).padStart(2, '0')}-01`;
  }
  if (charge && monthYear) {
    const day = Number(charge[1]);
    const month = Number(charge[2]);
    const year = month < monthYear.month ? monthYear.year + 1 : monthYear.year;
    const iso = parseStatementDate(`${day}/${month}/${year}`);
    if (iso) info.periodTo = iso;
  }
  return Object.keys(info).length > 0 ? info : null;
}

/** Totals / section headings that are never money rows. */
const TOTALS_PREFIXES = ['סה"כ', 'סהכ', 'total', 'סך הכל', 'סך כל'];

/**
 * Isracard prints several tables on one sheet, each under its own heading
 * ("transactions not yet captured", "transactions for the billing date").
 * The engine re-detects a header row after each of these anyway; listing
 * them keeps them out of the warnings.
 */
const ISRACARD_SECTIONS = ['עסקאות שטרם נקלטו', 'עסקאות למועד חיוב', 'עסקאות בחו"ל', 'עסקאות בארץ'];

export const STATEMENT_PRESETS: readonly StatementPreset[] = [
  {
    // Bank Hapoalim — `.xlsx`/`.csv`, a few title rows, debit/credit pair.
    id: 'hapoalim',
    detect: {
      headers: [['תאריך'], ['הפעולה', 'תאור הפעולה'], ['חובה', 'בחובה'], ['זכות', 'בזכות']],
      titles: ['תנועות בחשבון', 'עובר ושב'],
    },
    headerAliases: {
      date: ['תאריך', 'תאריך ביצוע'],
      valueDate: ['תאריך ערך'],
      description: ['הפעולה', 'תאור הפעולה', 'תיאור הפעולה'],
      memo: ['פרטים', 'לטובת', 'עבור'],
      reference: ['אסמכתא'],
      debit: ['חובה', 'בחובה'],
      credit: ['זכות', 'בזכות'],
      balance: ['יתרה', 'היתרה', 'יתרה בש"ח', 'יתרה לאחר פעולה'],
    },
    convention: 'debit-credit',
    skipDescriptionPrefixes: TOTALS_PREFIXES,
    defaultCurrency: 'ILS',
  },
  {
    // Bank Leumi — an HTML table saved as `.xls`; the decoder hands us rows.
    id: 'leumi',
    detect: {
      headers: [['תאריך'], ['תיאור', 'תאור'], ['בחובה', 'חובה'], ['בזכות', 'זכות']],
      titles: ['תנועות בחשבון'],
    },
    headerAliases: {
      date: ['תאריך'],
      valueDate: ['תאריך ערך'],
      description: ['תיאור', 'תאור'],
      reference: ['אסמכתא'],
      debit: ['בחובה', 'חובה'],
      credit: ['בזכות', 'זכות'],
      balance: ['היתרה', 'יתרה', 'יתרה בש"ח'],
    },
    convention: 'debit-credit',
    skipDescriptionPrefixes: TOTALS_PREFIXES,
    defaultCurrency: 'ILS',
  },
  {
    // Israel Discount Bank — one signed amount column.
    id: 'discount',
    detect: {
      headers: [['תאריך'], ['תיאור התנועה', 'תאור התנועה'], ['זכות/חובה', 'חובה/זכות', 'סכום']],
    },
    headerAliases: {
      date: ['תאריך'],
      valueDate: ['יום ערך', 'תאריך ערך'],
      description: ['תיאור התנועה', 'תאור התנועה'],
      memo: ['ערוץ ביצוע', 'פירוט'],
      reference: ['אסמכתא'],
      signedAmount: ['זכות/חובה', 'חובה/זכות', 'סכום'],
      balance: ['יתרה', 'היתרה', 'יתרה בחשבון'],
    },
    convention: 'signed',
    skipDescriptionPrefixes: TOTALS_PREFIXES,
    defaultCurrency: 'ILS',
  },
  {
    // Isracard — several tables per sheet, totals rows, billing-cycle titles.
    id: 'isracard',
    detect: {
      // `תאריך רכישה` (and not `תאריך עסקה`) is what separates an Isracard
      // export from Cal's and Max's, which also print `סכום חיוב`.
      headers: [['תאריך רכישה'], ['שם בית עסק', 'שם בית העסק'], ['סכום חיוב']],
      titles: ['לחיוב ב', 'פירוט עסקאות'],
    },
    headerAliases: {
      date: ['חיוב בחשבון הבנק', 'תאריך חיוב', 'מועד חיוב'],
      valueDate: ['תאריך רכישה', 'תאריך עסקה'],
      description: ['שם בית עסק', 'שם בית העסק'],
      amount: ['סכום חיוב'],
      chargeCurrency: ['מטבע חיוב'],
      originalAmount: ['סכום עסקה'],
      originalCurrency: ['מטבע עסקה'],
      reference: ["מס' שובר", 'מספר שובר'],
      memo: ['פירוט נוסף', 'הערות'],
      installments: ['פירוט נוסף', 'הערות'],
    },
    convention: 'charge-original',
    skipDescriptionPrefixes: [...TOTALS_PREFIXES, ...ISRACARD_SECTIONS],
    skipRowMarkers: ISRACARD_SECTIONS,
    titleExtractors: [extractBillingCycle, extractLast4],
    defaultCurrency: 'ILS',
  },
  {
    // Visa Cal — header cells may contain line breaks (normalizeHeader folds them).
    id: 'cal',
    detect: {
      headers: [
        ['תאריך עסקה'],
        ['שם בית עסק', 'שם בית העסק'],
        ['סכום בש"ח', 'סכום חיוב', 'סכום החיוב'],
      ],
      titles: ['פירוט עסקאות וזיכויים'],
    },
    headerAliases: {
      date: ['מועד חיוב', 'תאריך חיוב'],
      valueDate: ['תאריך עסקה'],
      description: ['שם בית עסק', 'שם בית העסק'],
      amount: ['סכום בש"ח', 'סכום חיוב', 'סכום החיוב'],
      originalAmount: ['סכום עסקה', 'סכום בדולר'],
      originalCurrency: ['מטבע עסקה'],
      categoryHint: ['סוג עסקה'],
      memo: ['הערות'],
      installments: ['הערות', 'סוג עסקה'],
    },
    convention: 'charge-original',
    skipDescriptionPrefixes: TOTALS_PREFIXES,
    titleExtractors: [extractBillingCycle, extractLast4],
    defaultCurrency: 'ILS',
  },
  {
    // Max (formerly Leumi Card) — `dd-mm-yyyy` dates, issuer sector column.
    id: 'max',
    detect: {
      headers: [['תאריך עסקה'], ['שם בית העסק', 'שם בית עסק'], ['סכום חיוב'], ['קטגוריה']],
      titles: ['כל המשתמשים', 'פירוט עסקאות'],
    },
    headerAliases: {
      date: ['תאריך חיוב'],
      valueDate: ['תאריך עסקה'],
      description: ['שם בית העסק', 'שם בית עסק'],
      categoryHint: ['קטגוריה'],
      amount: ['סכום חיוב'],
      chargeCurrency: ['מטבע חיוב'],
      originalAmount: ['סכום עסקה מקורי', 'סכום עסקה'],
      originalCurrency: ['מטבע עסקה'],
      memo: ['הערות', 'אופן ביצוע'],
      installments: ['הערות', 'אופן ביצוע'],
    },
    convention: 'charge-original',
    skipDescriptionPrefixes: TOTALS_PREFIXES,
    titleExtractors: [extractBillingCycle, extractLast4],
    defaultCurrency: 'ILS',
  },
  {
    // The fallback: common Hebrew/English column names, either amount shape.
    // Also what the manual column picker maps onto.
    id: 'generic_csv',
    detect: {
      headers: [
        ['date', 'תאריך', 'transaction date', 'posting date'],
        ['amount', 'סכום', 'debit', 'credit', 'חובה', 'זכות', 'sum'],
      ],
    },
    headerAliases: {
      date: ['date', 'תאריך', 'transaction date', 'posting date', 'booking date'],
      valueDate: ['value date', 'תאריך ערך', 'יום ערך'],
      description: [
        'description',
        'תיאור',
        'תאור',
        'details',
        'payee',
        'merchant',
        'name',
        'narration',
        'שם בית עסק',
      ],
      memo: ['memo', 'notes', 'note', 'הערות', 'פרטים'],
      reference: ['reference', 'ref', 'אסמכתא', 'id'],
      debit: ['debit', 'withdrawal', 'חובה', 'בחובה'],
      credit: ['credit', 'deposit', 'זכות', 'בזכות'],
      signedAmount: ['amount', 'סכום', 'sum', 'value'],
      balance: ['balance', 'יתרה', 'היתרה'],
      chargeCurrency: ['currency', 'מטבע'],
      categoryHint: ['category', 'קטגוריה'],
      installments: ['installments', 'תשלומים'],
    },
    convention: 'auto',
    skipDescriptionPrefixes: TOTALS_PREFIXES,
    defaultCurrency: 'ILS',
  },
];

export const STATEMENT_PRESETS_BY_ID: Readonly<Record<StatementPresetId, StatementPreset>> =
  Object.fromEntries(STATEMENT_PRESETS.map((preset) => [preset.id, preset])) as Record<
    StatementPresetId,
    StatementPreset
  >;

/** The preset a manual column mapping borrows its conventions from. */
export const FALLBACK_PRESET_ID: StatementPresetId = 'generic_csv';
