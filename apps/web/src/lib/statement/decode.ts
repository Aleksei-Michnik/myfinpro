// Phase 20 · 20.5 — decode a statement file in the browser into rows of
// strings for `parseStatementRows` (design §4.1). Nothing binary leaves the
// device: the caller sends only the parsed lines to the API.
//
// CSV: UTF-8 (BOM tolerated) or windows-1255 — Israeli banks still ship the
// legacy code page. XLSX, legacy BIFF `.xls` and HTML tables saved as `.xls`
// (Leumi) all go through SheetJS, dense sheets, no formulas evaluated.

import { read, set_cptable, utils } from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';

// Legacy BIFF `.xls` files carry their text in a code page (windows-1255 for
// Hebrew banks); the ESM build reads them only once the tables are wired in.
set_cptable(cptable);

/** Hard cap before decoding — a statement is kilobytes, never more (research §6). */
export const STATEMENT_FILE_MAX_BYTES = 5 * 1024 * 1024;

export const STATEMENT_FILE_EXTENSIONS = ['csv', 'xlsx', 'xls'] as const;
export type StatementFileKind = (typeof STATEMENT_FILE_EXTENSIONS)[number];

export type DecodeErrorCode = 'unsupported' | 'tooBig' | 'unreadable';

export class StatementDecodeError extends Error {
  constructor(public readonly code: DecodeErrorCode) {
    super(code);
    this.name = 'StatementDecodeError';
  }
}

export interface DecodedStatement {
  kind: StatementFileKind;
  /** Every row of the first sheet, cells as trimmed strings, empty rows dropped. */
  rows: string[][];
}

/** The file kind from its name; `null` when we do not read it. */
export function statementFileKind(name: string): StatementFileKind | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return (STATEMENT_FILE_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as StatementFileKind)
    : null;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** UTF-8 when the bytes decode cleanly, else windows-1255 (the banks' legacy page). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1255').decode(bytes);
  }
}

/** RFC 4180-ish: quoted fields, doubled quotes, CR/LF rows; the delimiter is sniffed. */
export function parseCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = sniffDelimiter(body);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return tidy(rows);
}

function sniffDelimiter(text: string): string {
  const head = text.slice(0, 4096);
  const counts = [',', ';', '\t'].map((d) => ({ d, n: head.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

// ── Spreadsheets ────────────────────────────────────────────────────────────

export function decodeWorkbook(bytes: Uint8Array): string[][] {
  // `raw: true` on read keeps HTML/CSV cells as the text they were — SheetJS
  // would otherwise parse `01/09/2026` month-first, wrong for Israeli exports.
  const wb = read(bytes, {
    type: 'array',
    dense: true,
    raw: true,
    cellFormula: false,
    cellHTML: false,
  });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  // Excel date serials stay numeric (the shared parser reads them); every
  // cell comes back as a string through `String()` below.
  const grid = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  return tidy(grid.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))));
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function decodeStatementFile(file: File): Promise<DecodedStatement> {
  const kind = statementFileKind(file.name);
  if (!kind) throw new StatementDecodeError('unsupported');
  if (file.size > STATEMENT_FILE_MAX_BYTES) throw new StatementDecodeError('tooBig');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const rows = kind === 'csv' ? parseCsv(decodeCsvBytes(bytes)) : decodeWorkbook(bytes);
    if (rows.length === 0) throw new StatementDecodeError('unreadable');
    return { kind, rows };
  } catch (err) {
    if (err instanceof StatementDecodeError) throw err;
    throw new StatementDecodeError('unreadable');
  }
}

/** Trim cells, drop rows that hold nothing. */
function tidy(rows: string[][]): string[][] {
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}
