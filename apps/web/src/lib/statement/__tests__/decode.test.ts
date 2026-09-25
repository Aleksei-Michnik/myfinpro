import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import {
  STATEMENT_FILE_MAX_BYTES,
  StatementDecodeError,
  decodeCsvBytes,
  decodeStatementFile,
  decodeWorkbook,
  parseCsv,
  redactFileName,
  statementFileKind,
} from '../decode';

function fileOf(name: string, bytes: Uint8Array | string): File {
  return new File([bytes as BlobPart], name);
}

describe('statementFileKind', () => {
  it('reads the extension case-insensitively and refuses the rest', () => {
    expect(statementFileKind('Hapoalim.CSV')).toBe('csv');
    expect(statementFileKind('export.xlsx')).toBe('xlsx');
    expect(statementFileKind('leumi.xls')).toBe('xls');
    expect(statementFileKind('scan.pdf')).toBeNull();
    expect(statementFileKind('noext')).toBeNull();
  });
});

describe('decodeCsvBytes', () => {
  it('decodes clean UTF-8 (BOM included)', () => {
    const bytes = new TextEncoder().encode('﻿תאריך,סכום\n');
    expect(decodeCsvBytes(bytes)).toBe('תאריך,סכום\n');
  });

  it('falls back to windows-1255 when the bytes are not UTF-8', () => {
    // "אב" in windows-1255 is 0xE0 0xE1 — invalid as UTF-8.
    const bytes = new Uint8Array([0xe0, 0xe1, 0x2c, 0x31]);
    expect(decodeCsvBytes(bytes)).toBe('אב,1');
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, CRLF and trims cells', () => {
    const rows = parseCsv('﻿a, "b ""q""" ,c\r\n1,2,3\r\n\r\n');
    expect(rows).toEqual([
      ['a', 'b "q"', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('sniffs a semicolon or tab delimiter', () => {
    expect(parseCsv('x;y;z\n1;2;3')).toEqual([
      ['x', 'y', 'z'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('x\ty\n1\t2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('keeps a newline inside a quoted cell', () => {
    expect(parseCsv('"multi\nline",2')).toEqual([['multi\nline', '2']]);
  });
});

describe('decodeWorkbook', () => {
  it('reads the first sheet as strings, keeps date serials numeric, drops empty rows', () => {
    const wb = utils.book_new();
    const sheet = utils.aoa_to_sheet([['תאריך', 'פרטים', 'חובה'], [], [46283, 'שופרסל', 45.9]]);
    utils.book_append_sheet(wb, sheet, 'Sheet1');
    const bytes = new Uint8Array(write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(decodeWorkbook(bytes)).toEqual([
      ['תאריך', 'פרטים', 'חובה'],
      ['46283', 'שופרסל', '45.9'],
    ]);
  });

  it('reads an HTML table saved as .xls (the Leumi export)', () => {
    const html =
      '<html><body><table><tr><td>תאריך</td><td>בחובה</td></tr>' +
      '<tr><td>01/09/2026</td><td>12.50</td></tr></table></body></html>';
    expect(decodeWorkbook(new TextEncoder().encode(html))).toEqual([
      ['תאריך', 'בחובה'],
      ['01/09/2026', '12.50'],
    ]);
  });
});

describe('decodeStatementFile', () => {
  it('rejects an unsupported extension before reading', async () => {
    await expect(decodeStatementFile(fileOf('x.pdf', 'a'))).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('rejects a file over the size cap', async () => {
    const big = { name: 'x.csv', size: STATEMENT_FILE_MAX_BYTES + 1 } as File;
    await expect(decodeStatementFile(big)).rejects.toBeInstanceOf(StatementDecodeError);
  });

  it('decodes a CSV file into rows', async () => {
    const res = await decodeStatementFile(fileOf('h.csv', 'תאריך,סכום\n01/09/2026,10'));
    expect(res.kind).toBe('csv');
    expect(res.rows).toEqual([
      ['תאריך', 'סכום'],
      ['01/09/2026', '10'],
    ]);
  });

  it('reports an empty file as unreadable', async () => {
    await expect(decodeStatementFile(fileOf('h.csv', ''))).rejects.toMatchObject({
      code: 'unreadable',
    });
  });
});

describe('redactFileName', () => {
  it('hides digit runs that could be an account or card number, keeps the rest', () => {
    expect(redactFileName('hapoalim_12345678_sept.xlsx')).toBe('hapoalim_…_sept.xlsx');
    expect(redactFileName('export-2026-09.csv')).toBe('export-2026-09.csv');
  });
});
