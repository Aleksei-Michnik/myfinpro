// Phase 20 · Iteration 20.7 — `myfinpro-connector sync`.
//
// Scrape on this machine, map, push. What leaves the machine is exactly the
// normalised lines of `POST /accounts/:id/imports` — no file, no credential,
// no account number beyond the last digits the user themself mapped.

import type { TransactionsAccount } from 'israeli-bank-scrapers/lib/transactions.js';
import { ApiClient } from '../client.js';
import { importSourceFor } from '../companies.js';
import { lastFourOf, readConfig, selectProfiles, type ConnectorProfile } from '../config.js';
import { configError, EXIT_OK } from '../errors.js';
import { mapTransactions, type MappedTransactions } from '../map.js';
import { formatAmount, writeLine } from '../output.js';
import { defaultStartDate, parseSince, scrapeProfile } from '../scrape.js';

/** How many mapped lines `--dry-run` shows per account. */
export const DRY_RUN_SAMPLE_SIZE = 3;

export interface SyncOptions {
  since?: string;
  dryRun?: boolean;
  profile?: string;
}

function mappingFor(
  profile: ConnectorProfile,
  account: TransactionsAccount,
): { accountId: string; last4: string } | null {
  const last4 = lastFourOf(account.accountNumber ?? '');
  const mapping = profile.accounts.find(
    (candidate) => last4 !== '' && last4.endsWith(candidate.last4),
  );
  return mapping ? { accountId: mapping.accountId, last4 } : null;
}

function reportMapping(mapped: MappedTransactions, scraped: number): string {
  const parts = [`scraped ${scraped}`, `lines ${mapped.lines.length}`];
  if (mapped.pendingCount > 0) parts.push(`${mapped.pendingCount} still pending at the bank`);
  if (mapped.skipped.length > 0) parts.push(`${mapped.skipped.length} unusable`);
  return parts.join(', ');
}

function printSample(mapped: MappedTransactions): void {
  for (const line of mapped.lines.slice(0, DRY_RUN_SAMPLE_SIZE)) {
    const amount = formatAmount(
      line.direction === 'OUT' ? -line.amountCents : line.amountCents,
      line.currency,
    );
    const installments =
      line.installmentNumber && line.installmentTotal
        ? ` [${line.installmentNumber}/${line.installmentTotal}]`
        : '';
    const original = line.originalAmountCents
      ? ` (${formatAmount(line.originalAmountCents, line.originalCurrency ?? '')})`
      : '';
    writeLine(`      ${line.postedAt}  ${amount}${original}${installments}  ${line.description}`);
  }
}

export async function runSync(options: SyncOptions = {}): Promise<number> {
  const config = await readConfig();
  const profiles = selectProfiles(config, options.profile);
  const startDate = options.since ? parseSince(options.since) : defaultStartDate();
  const client = new ApiClient({ appUrl: config.appUrl, token: config.token });

  writeLine(
    `Scraping from ${startDate.toISOString().slice(0, 10)}${options.dryRun ? ' (dry run — nothing is sent)' : ''}`,
  );

  let mappedAccounts = 0;
  let unmappedAccounts = 0;

  for (const profile of profiles) {
    writeLine('');
    writeLine(`${profile.name} (${profile.companyId})`);
    const accounts = await scrapeProfile(profile, { startDate });
    const source = importSourceFor(profile.companyId);

    for (const account of accounts) {
      const mapping = mappingFor(profile, account);
      const last4 = lastFourOf(account.accountNumber ?? '');
      const label = `  account ••${last4 || '????'}`;

      if (!mapping) {
        unmappedAccounts += 1;
        writeLine(`${label}: not mapped — ${account.txns.length} transactions skipped`);
        continue;
      }
      mappedAccounts += 1;

      const mapped = mapTransactions(account.txns, { currency: account.currency });
      writeLine(`${label} → ${mapping.accountId}`);
      writeLine(`    ${reportMapping(mapped, account.txns.length)}`);

      if (mapped.lines.length === 0) continue;

      if (options.dryRun) {
        printSample(mapped);
        continue;
      }

      const summary = await client.createImports(mapping.accountId, source, mapped.lines);
      writeLine(
        `    inserted ${summary.insertedCount}, duplicates ${summary.duplicateCount}, ` +
          `needs input ${summary.needsInputCount}`,
      );
      writeLine(`    review: ${client.reviewUrl(mapping.accountId)}`);
    }
  }

  if (mappedAccounts === 0) {
    throw configError(
      unmappedAccounts > 0
        ? 'None of the scraped accounts is mapped to a MyFinPro account.'
        : 'The scrape returned no accounts.',
      'Run: myfinpro-connector accounts   then map them with: myfinpro-connector init',
    );
  }
  if (unmappedAccounts > 0) {
    writeLine('');
    writeLine(`${unmappedAccounts} scraped account(s) have no mapping and were skipped.`);
  }
  return EXIT_OK;
}
