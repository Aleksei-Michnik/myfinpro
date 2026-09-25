// Phase 20 · Iteration 20.7 — the connector's failure vocabulary.
//
// Every command fails through `ConnectorError`, whose exit code is part of the
// CLI contract (README, "Exit codes"): a scheduler reads the code, a human
// reads the message. A message NEVER carries a credential, a token or a
// statement row — the scraper's own error text is surfaced as it comes, which
// is why the scrape path passes `errorType`/`errorMessage` only (design §9).

export const EXIT_OK = 0;
/** Wrong command line: unknown command, bad flag, missing value. */
export const EXIT_USAGE = 1;
/** Missing, unreadable, group/world-readable or invalid configuration. */
export const EXIT_CONFIG = 2;
/** The bank scrape itself failed (login, timeout, site change, no browser). */
export const EXIT_SCRAPE = 3;
/** The app rejected the import (status + errorCode). */
export const EXIT_API = 4;

export class ConnectorError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
    /** One extra line printed under the message: what the user should do. */
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export const usageError = (message: string, hint?: string): ConnectorError =>
  new ConnectorError(EXIT_USAGE, message, hint);

export const configError = (message: string, hint?: string): ConnectorError =>
  new ConnectorError(EXIT_CONFIG, message, hint);

export const scrapeError = (message: string, hint?: string): ConnectorError =>
  new ConnectorError(EXIT_SCRAPE, message, hint);

export const apiError = (message: string, hint?: string): ConnectorError =>
  new ConnectorError(EXIT_API, message, hint);
