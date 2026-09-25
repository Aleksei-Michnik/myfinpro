// Phase 20 · Iteration 20.7 — driving israeli-bank-scrapers on this machine.
//
// The credentials are read from the local config and handed straight to the
// library; they exist in this process's memory and nowhere else (design §3.5).
// Nothing here logs them, and a failure is reported with the library's own
// `errorType`/`errorMessage` only.
//
// puppeteer and the scrapers are imported LAZILY: `init`, `doctor` and the
// tests must not pay for a browser automation stack they never start.

import { existsSync } from 'node:fs';
import type { ScraperCredentials } from 'israeli-bank-scrapers/lib/scrapers/interface.js';
import type { TransactionsAccount } from 'israeli-bank-scrapers/lib/transactions.js';
import { companyName, requireCompanyId } from './companies.js';
import type { ConnectorProfile } from './config.js';
import { scrapeError } from './errors.js';

/** How far back a sync without `--since` looks. */
export const DEFAULT_SINCE_DAYS = 60;

/** The timezone the Israeli institutions print their dates in (see map.ts). */
export const BANK_TIMEZONE = 'Asia/Jerusalem';

export const BROWSER_MISSING_HINT =
  'Install the browser once with: npx puppeteer browsers install chrome';

/** Midnight, `days` before `now`, in the machine's local timezone. */
export function defaultStartDate(now: Date = new Date(), days = DEFAULT_SINCE_DAYS): Date {
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** `--since YYYY-MM-DD` → local midnight of that day. */
export function parseSince(raw: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) throw scrapeError(`--since must be a date like 2026-09-01, not "${raw}".`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime()) || date.getDate() !== Number(match[3])) {
    throw scrapeError(`"${raw}" is not a real date.`);
  }
  return date;
}

/**
 * Path of the Chrome puppeteer will drive, or a clear failure. pnpm refuses to
 * run puppeteer's install script (it is not in `onlyBuiltDependencies`), so the
 * browser is a deliberate one-time step rather than a surprise 300 MB download
 * during `pnpm install`.
 */
export async function findBrowser(): Promise<string> {
  const puppeteer = (await import('puppeteer')).default;
  let executablePath: string;
  try {
    executablePath = puppeteer.executablePath();
  } catch {
    throw scrapeError('No browser for the scrapers is installed.', BROWSER_MISSING_HINT);
  }
  if (!executablePath || !existsSync(executablePath)) {
    throw scrapeError(`No browser at ${executablePath || '(unknown path)'}.`, BROWSER_MISSING_HINT);
  }
  return executablePath;
}

export interface ScrapeOptions {
  startDate: Date;
}

/**
 * Logs in and returns the scraped accounts. `showBrowser: false` and
 * `verbose: false` keep a scheduled run silent and headless;
 * `combineInstallments: false` keeps one line per monthly charge, which is
 * what the bank actually debits and therefore what reconciles (design §2.4).
 */
export async function scrapeProfile(
  profile: ConnectorProfile,
  options: ScrapeOptions,
): Promise<TransactionsAccount[]> {
  const companyId = requireCompanyId(profile.companyId);
  await findBrowser();

  const { createScraper } = await import('israeli-bank-scrapers');
  const scraper = createScraper({
    companyId,
    startDate: options.startDate,
    showBrowser: false,
    verbose: false,
    combineInstallments: false,
  });

  let result;
  try {
    result = await scraper.scrape(profile.credentials as unknown as ScraperCredentials);
  } catch (error) {
    // Puppeteer's own failures (navigation, crash) arrive as throws. The
    // message is the library's; the credentials are never part of it.
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw scrapeError(`${companyName(companyId)}: the scraper failed — ${detail}`);
  }

  if (!result.success) {
    const detail = [result.errorType, result.errorMessage].filter(Boolean).join(' — ');
    throw scrapeError(
      `${companyName(companyId)}: scraping failed${detail ? ` (${detail})` : ''}.`,
      'A wrong password, a one-time code the bank now requires, or a changed bank site all land here.',
    );
  }

  return result.accounts ?? [];
}
