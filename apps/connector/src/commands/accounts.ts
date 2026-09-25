// Phase 20 · Iteration 20.7 — `myfinpro-connector accounts`.
//
// Logs in and lists what the bank has, so the user can map each scraped
// account to a MyFinPro account id in `init`. Nothing is sent anywhere; the
// full account number is never printed, only the last digits `init` asks for.

import { lastFourOf, readConfig, selectProfiles } from '../config.js';
import { EXIT_OK } from '../errors.js';
import { formatAmount, writeLine } from '../output.js';
import { defaultStartDate, parseSince, scrapeProfile } from '../scrape.js';

/** A short window: this command only needs the account list, not history. */
export const ACCOUNTS_SINCE_DAYS = 7;

export interface AccountsOptions {
  since?: string;
  profile?: string;
}

export async function runAccounts(options: AccountsOptions = {}): Promise<number> {
  const config = await readConfig();
  const profiles = selectProfiles(config, options.profile);
  const startDate = options.since
    ? parseSince(options.since)
    : defaultStartDate(new Date(), ACCOUNTS_SINCE_DAYS);

  for (const profile of profiles) {
    writeLine('');
    writeLine(`${profile.name} (${profile.companyId})`);
    const accounts = await scrapeProfile(profile, { startDate });

    if (accounts.length === 0) {
      writeLine('  the scrape returned no accounts');
      continue;
    }

    for (const account of accounts) {
      const last4 = lastFourOf(account.accountNumber ?? '') || '????';
      const currency = account.currency ?? '';
      const balance =
        typeof account.balance === 'number'
          ? formatAmount(Math.round(account.balance * 100), currency || 'ILS')
          : 'balance not reported';
      const mapping = profile.accounts.find((candidate) => last4.endsWith(candidate.last4));
      writeLine(
        `  ••${last4}  ${balance}  ${account.txns.length} transactions  ` +
          (mapping ? `→ ${mapping.accountId}` : '→ not mapped'),
      );
    }
  }

  writeLine('');
  writeLine('Map an account with: myfinpro-connector init');
  return EXIT_OK;
}
