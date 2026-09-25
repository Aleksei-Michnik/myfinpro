// Phase 20 · Iteration 20.4 — request body limits, in one place.
//
// Nest's built-in parser applies one limit (express's 100 KB default) to every
// route, which is right for every body this API takes except one: a statement
// import carries up to ACCOUNT_IMPORT_MAX_LINES normalised rows and would be
// rejected with a bare 413 before any of its validation ran (security review
// M4). The bigger limit is scoped to that single route, so nothing else gains
// the right to post megabytes.
//
// Used by `main.ts` and by the integration bootstrap, so the tests exercise
// the same limits production runs.

import { ACCOUNT_IMPORT_MAX_LINES, STATEMENT_DESCRIPTION_MAX_LENGTH } from '@myfinpro/shared';
import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import {
  IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH,
  IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH,
} from '../../account/dto/import-line.dto';

/**
 * The limit is DERIVED from what a legal maximum chunk actually weighs — a
 * limit smaller than the contract would reject imports the API promises to
 * accept, which is the bug this exists to prevent.
 *
 * Per line: a description and a memo at their column maximum, a category
 * hint, a reference, and the keys, numbers and punctuation around them. The
 * text caps are in CHARACTERS, so the byte budget assumes the worst case for
 * a BMP character in UTF-8 (Hebrew costs two, an emoji three).
 */
const MAX_BYTES_PER_CHAR = 3;
const IMPORT_LINE_TEXT_CHARS =
  STATEMENT_DESCRIPTION_MAX_LENGTH * 2 +
  IMPORT_LINE_CATEGORY_HINT_MAX_LENGTH +
  IMPORT_LINE_EXTERNAL_ID_MAX_LENGTH;
/** Keys, dates, amounts and punctuation of one line object. */
const IMPORT_LINE_STRUCTURE_BYTES = 256;

/** ≈ 5 MB at 2000 lines — one authenticated route, throttled to 10/min. */
export const ACCOUNT_IMPORT_BODY_LIMIT_BYTES =
  ACCOUNT_IMPORT_MAX_LINES *
  (IMPORT_LINE_TEXT_CHARS * MAX_BYTES_PER_CHAR + IMPORT_LINE_STRUCTURE_BYTES);

/** Express's own default, kept explicit so the contrast is visible. */
export const DEFAULT_BODY_LIMIT = '100kb';

/**
 * The import route, as express matches it — the global prefix is part of the
 * URL by the time a plain `app.use` path is tested.
 */
export const IMPORT_BODY_ROUTE = '/api/v1/accounts/:accountId/imports';

/**
 * Register the body parsers. The route-scoped one runs first; body-parser
 * marks the request as parsed, so the default that follows leaves it alone.
 *
 * Requires the app to have been created with `bodyParser: false`, otherwise
 * Nest's own parser has already rejected the large body.
 */
export function applyBodyParsers(app: INestApplication): void {
  app.use(IMPORT_BODY_ROUTE, json({ limit: ACCOUNT_IMPORT_BODY_LIMIT_BYTES }));
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}
