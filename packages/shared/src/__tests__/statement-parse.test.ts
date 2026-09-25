import { describe, expect, it } from 'vitest';
import { detectPreset, parseStatementRows } from '../statement/parse';
import { STATEMENT_PRESETS, STATEMENT_PRESETS_BY_ID } from '../statement/presets';
import { STATEMENT_PRESET_IDS } from '../statement/types';

// ── synthetic fixtures ──
//
// Built by hand from the verbatim header lists in
// docs/notes/bank-sync-research-2026-09.md §3. Descriptions are invented
// Israeli merchants; no real statement, account number or card number was
// used, and none may ever be committed here (design §9).

/** Bank Hapoalim: title rows, a debit/credit pair, a running balance, totals. */
const HAPOALIM_ROWS: string[][] = [
  ['תנועות בחשבון עובר ושב'],
  ['הופק בתאריך 08/09/2026'],
  [],
  ['תאריך', 'הפעולה', 'פרטים', 'אסמכתא', 'חובה', 'זכות', 'תאריך ערך', 'יתרה'],
  ['03/09/2026', 'משיכת מזומן', 'כספומט דיזנגוף', '12345', '200.00', '', '03/09/2026', '5,300.50'],
  ['04/09/2026', 'העברה', 'משכורת ספטמבר', '12346', '', '12,000.00', '04/09/2026', '17,300.50'],
  ['05/09/2026', 'ישראכרט', 'חיוב כרטיס אשראי', '12347', '1,240.00', '', '05/09/2026', '16,060.50'],
  ['סה"כ', '', '', '', '1,440.00', '12,000.00', '', ''],
];

/** Bank Leumi: the HTML-table export, `dd.mm.yy` dates, `בחובה`/`בזכות`. */
const LEUMI_ROWS: string[][] = [
  ['תנועות בחשבון'],
  [],
  ['תאריך', 'תאריך ערך', 'תיאור', 'אסמכתא', 'בחובה', 'בזכות', 'היתרה'],
  ['05.09.26', '05.09.26', 'הוראת קבע חשמל', '7788', '₪ 312.40', '', '₪ 4,988.10'],
  ['06.09.26', '06.09.26', 'הפקדת שיק', '7789', '', '₪ 900.00', '₪ 5,888.10'],
];

/** Israel Discount Bank: one signed amount column. */
const DISCOUNT_ROWS: string[][] = [
  ['תנועות אחרונות'],
  ['תאריך', 'תיאור התנועה', 'יום ערך', 'זכות/חובה', 'ערוץ ביצוע', 'יתרה'],
  ['06/09/2026', 'קניה בשופרסל', '06/09/2026', '-150.90', 'אינטרנט', '2,300.00'],
  ['07/09/2026', 'זיכוי החזר', '07/09/2026', '75.00', 'סניף', '2,375.00'],
];

/** Isracard: two tables on one sheet, totals rows, billing-cycle titles. */
const ISRACARD_ROWS: string[][] = [
  ['ישראכרט - 0423'],
  ['ספטמבר 2026'],
  ['לחיוב ב-10.09'],
  [],
  ['עסקאות למועד חיוב'],
  [
    'תאריך רכישה',
    'שם בית עסק',
    'סכום עסקה',
    'מטבע עסקה',
    'סכום חיוב',
    'מטבע חיוב',
    "מס' שובר",
    'פירוט נוסף',
  ],
  ['01/09/2026', 'סופר פארם', '89.90', '₪', '89.90', '₪', '778812', ''],
  ['02/09/2026', 'AMAZON MARKETPLACE', '25.00', '$', '92.50', '₪', '778813', 'תשלום 2 מתוך 6'],
  ['סה"כ', '', '', '', '182.40', '', '', ''],
  [],
  ['עסקאות שטרם נקלטו'],
  [
    'תאריך רכישה',
    'שם בית עסק',
    'סכום עסקה',
    'מטבע עסקה',
    'סכום חיוב',
    'מטבע חיוב',
    "מס' שובר",
    'פירוט נוסף',
  ],
  ['08/09/2026', 'רמי לוי', '-40.00', '₪', '-40.00', '₪', '778814', 'זיכוי'],
];

/** Visa Cal: purchase date and charge date in separate columns. */
const CAL_ROWS: string[][] = [
  ['פירוט עסקאות וזיכויים'],
  ['ויזה כאל - 1234'],
  ['ספטמבר 2026'],
  ['לחיוב ב-02.10'],
  [],
  ['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'סכום בש"ח', 'סוג עסקה', 'הערות', 'מועד חיוב'],
  ['10/09/2026', 'דלק פז', '250.00', '250.00', 'רגילה', '', '02/10/2026'],
  ['12/09/2026', 'חנות ספרים', '720.00', '120.00', 'תשלומים', 'תשלום 2 מתוך 6', '02/10/2026'],
];

/** Max: `dd-mm-yyyy` dates, the issuer's own sector column, an original pair. */
const MAX_ROWS: string[][] = [
  ['כל המשתמשים'],
  [],
  [
    'תאריך עסקה',
    'שם בית העסק',
    'קטגוריה',
    'סכום חיוב',
    'סכום עסקה מקורי',
    'מטבע חיוב',
    'מטבע עסקה',
    'תאריך חיוב',
    'אופן ביצוע',
    'הערות',
  ],
  ['15-09-2026', 'מסעדת פסטה', 'מסעדות', '180.50', '180.50', '₪', '₪', '02-10-2026', 'רגילה', ''],
  ['16-09-2026', 'NETFLIX.COM', 'פנאי', '55.90', '15.49', '₪', '$', '02-10-2026', 'רגילה', ''],
];

/** A plain English CSV — the `generic_csv` fallback. */
const GENERIC_CSV_ROWS: string[][] = [
  ['Date', 'Description', 'Amount', 'Balance', 'Reference'],
  ['2026-09-03', 'Coffee shop', '-12.50', '1,200.00', 'A1'],
  ['2026-09-04', 'Salary', '5,000.00', '6,200.00', 'A2'],
];

/** Headers nothing recognises — what the manual column picker is for. */
const UNRECOGNISED_ROWS: string[][] = [
  ['col a', 'col b', 'col c'],
  ['03/09/2026', 'קניות שבועיות', '-45.00'],
  ['04/09/2026', 'החזר', '45.00'],
];

// ── detection ──

describe('detectPreset', () => {
  it.each([
    ['hapoalim', HAPOALIM_ROWS],
    ['leumi', LEUMI_ROWS],
    ['discount', DISCOUNT_ROWS],
    ['isracard', ISRACARD_ROWS],
    ['cal', CAL_ROWS],
    ['max', MAX_ROWS],
    ['generic_csv', GENERIC_CSV_ROWS],
  ] as const)('recognises a %s export', (expected, rows) => {
    expect(detectPreset(rows)).toBe(expected);
  });

  it('returns null when no header row carries a date and an amount', () => {
    expect(detectPreset(UNRECOGNISED_ROWS)).toBeNull();
    expect(detectPreset([])).toBeNull();
  });

  it('keeps every preset id inside the import-source list', () => {
    expect(STATEMENT_PRESETS.map((preset) => preset.id).sort()).toEqual(
      [...STATEMENT_PRESET_IDS].sort(),
    );
    for (const id of STATEMENT_PRESET_IDS) {
      expect(STATEMENT_PRESETS_BY_ID[id].id).toBe(id);
    }
  });
});

// ── bank statements: the debit/credit and signed conventions ──

describe('parseStatementRows — bank presets', () => {
  it('reads a Hapoalim debit/credit statement and drops the totals row', () => {
    const result = parseStatementRows(HAPOALIM_ROWS);

    expect(result.preset).toBe('hapoalim');
    expect(result.warnings).toEqual([]);
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toMatchObject({
      postedAt: '2026-09-03',
      direction: 'OUT',
      amountCents: 20000,
      currency: 'ILS',
      description: 'משיכת מזומן',
      memo: 'כספומט דיזנגוף',
      externalId: '12345',
      balanceAfterCents: 530050,
    });
    expect(result.lines[1]).toMatchObject({ direction: 'IN', amountCents: 1200000 });
    // The running balance of the latest line becomes the statement balance.
    expect(result.statementBalanceCents).toBe(1606050);
    expect(result.statementBalanceAt).toBe('2026-09-05');
    expect(result.periodFrom).toBe('2026-09-03');
    expect(result.periodTo).toBe('2026-09-05');
  });

  it('reads a Leumi export with dd.mm.yy dates and shekel signs', () => {
    const result = parseStatementRows(LEUMI_ROWS);

    expect(result.preset).toBe('leumi');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      postedAt: '2026-09-05',
      direction: 'OUT',
      amountCents: 31240,
      description: 'הוראת קבע חשמל',
      balanceAfterCents: 498810,
    });
    expect(result.lines[1]).toMatchObject({ direction: 'IN', amountCents: 90000 });
  });

  it('reads Discount’s single signed column', () => {
    const result = parseStatementRows(DISCOUNT_ROWS);

    expect(result.preset).toBe('discount');
    expect(result.lines).toEqual([
      expect.objectContaining({ direction: 'OUT', amountCents: 15090, memo: 'אינטרנט' }),
      expect.objectContaining({ direction: 'IN', amountCents: 7500 }),
    ]);
  });
});

// ── card statements: charge vs original, installments, titles ──

describe('parseStatementRows — card presets', () => {
  it('reads both Isracard tables, keeps the original pair and the installments', () => {
    const result = parseStatementRows(ISRACARD_ROWS);

    expect(result.preset).toBe('isracard');
    expect(result.warnings).toEqual([]);
    expect(result.lines).toHaveLength(3);

    expect(result.lines[0]).toMatchObject({
      postedAt: '2026-09-01',
      direction: 'OUT',
      amountCents: 8990,
      currency: 'ILS',
      description: 'סופר פארם',
      externalId: '778812',
    });
    expect(result.lines[0].originalCurrency).toBeUndefined();

    expect(result.lines[1]).toMatchObject({
      direction: 'OUT',
      amountCents: 9250,
      originalAmountCents: 2500,
      originalCurrency: 'USD',
      installmentNumber: 2,
      installmentTotal: 6,
    });

    // The second table (not yet captured) — a negative charge is a refund.
    expect(result.lines[2]).toMatchObject({
      postedAt: '2026-09-08',
      direction: 'IN',
      amountCents: 4000,
      description: 'רמי לוי',
    });

    // Title rows: the card's masked id and the billing cycle.
    expect(result.last4).toBe('0423');
    expect(result.periodFrom).toBe('2026-09-01');
    expect(result.periodTo).toBe('2026-09-10');
  });

  it('separates Cal’s purchase date from its charge date', () => {
    const result = parseStatementRows(CAL_ROWS);

    expect(result.preset).toBe('cal');
    expect(result.lines[0]).toMatchObject({
      postedAt: '2026-10-02',
      valueAt: '2026-09-10',
      direction: 'OUT',
      amountCents: 25000,
      description: 'דלק פז',
      categoryHint: 'רגילה',
    });
    expect(result.lines[1]).toMatchObject({
      amountCents: 12000,
      originalAmountCents: 72000,
      installmentNumber: 2,
      installmentTotal: 6,
    });
    expect(result.last4).toBe('1234');
    expect(result.periodTo).toBe('2026-10-02');
  });

  it('reads Max’s dd-mm-yyyy dates, sector column and foreign original amount', () => {
    const result = parseStatementRows(MAX_ROWS);

    expect(result.preset).toBe('max');
    expect(result.lines[0]).toMatchObject({
      postedAt: '2026-10-02',
      valueAt: '2026-09-15',
      direction: 'OUT',
      amountCents: 18050,
      currency: 'ILS',
      categoryHint: 'מסעדות',
    });
    expect(result.lines[1]).toMatchObject({
      amountCents: 5590,
      originalAmountCents: 1549,
      originalCurrency: 'USD',
      description: 'NETFLIX.COM',
    });
  });
});

// ── the fallback and the manual picker ──

describe('parseStatementRows — generic and manual', () => {
  it('reads a plain English CSV through the generic preset', () => {
    const result = parseStatementRows(GENERIC_CSV_ROWS, { currency: 'USD' });

    expect(result.preset).toBe('generic_csv');
    expect(result.lines).toEqual([
      expect.objectContaining({
        postedAt: '2026-09-03',
        direction: 'OUT',
        amountCents: 1250,
        currency: 'USD',
        description: 'Coffee shop',
        externalId: 'A1',
        balanceAfterCents: 120000,
      }),
      expect.objectContaining({ direction: 'IN', amountCents: 500000 }),
    ]);
  });

  it('parses unrecognised rows through an explicit column mapping', () => {
    const result = parseStatementRows(UNRECOGNISED_ROWS, {
      mapping: { columns: { date: 0, description: 1, signedAmount: 2 }, headerRowIndex: 0 },
      currency: 'ILS',
    });

    expect(result.preset).toBe('manual');
    expect(result.lines).toEqual([
      expect.objectContaining({
        direction: 'OUT',
        amountCents: 4500,
        description: 'קניות שבועיות',
      }),
      expect.objectContaining({ direction: 'IN', amountCents: 4500, description: 'החזר' }),
    ]);
  });

  it('refuses a mapping without a date or a money column', () => {
    const result = parseStatementRows(UNRECOGNISED_ROWS, {
      mapping: { columns: { description: 1 } },
    });

    expect(result.preset).toBe('manual');
    expect(result.lines).toEqual([]);
    expect(result.warnings).toEqual([{ row: 0, code: 'no_header' }]);
  });

  it('reports no_header when nothing matches and no mapping was given', () => {
    expect(parseStatementRows(UNRECOGNISED_ROWS)).toEqual({
      preset: null,
      lines: [],
      warnings: [{ row: 0, code: 'no_header' }],
    });
  });
});

// ── warnings ──

describe('parseStatementRows — warnings', () => {
  const rowsWithNoise: string[][] = [
    ['תאריך', 'הפעולה', 'פרטים', 'אסמכתא', 'חובה', 'זכות', 'תאריך ערך', 'יתרה'],
    ['03/09/2026', 'משיכת מזומן', '', '', '200.00', '', '', ''],
    ['לא תאריך', 'שורה פגומה', '', '', 'לא סכום', '', '', ''],
    ['04/09/2026', 'ללא סכום', '', '', '', '', '', ''],
  ];

  it('carries the row index and the reason, and no other cell content', () => {
    const result = parseStatementRows(rowsWithNoise, { preset: 'hapoalim' });

    expect(result.lines).toHaveLength(1);
    expect(result.warnings).toEqual([
      { row: 2, code: 'row_unparsed', description: 'שורה פגומה' },
      { row: 3, code: 'invalid_amount', description: 'ללא סכום' },
    ]);
    // Nothing but the description ever reaches a warning.
    for (const warning of result.warnings) {
      expect(Object.keys(warning).sort()).toEqual(['code', 'description', 'row']);
    }
  });
});
