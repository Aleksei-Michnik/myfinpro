// Phase 20 · Iteration 20.7 — `myfinpro-connector doctor`.
//
// Everything that can be checked WITHOUT touching a bank or writing anything
// to the app: the config and its permissions, the browser, the machine's
// timezone, and whether the app answers at all (`GET /api/v1/health`, a public
// route). The token itself is NOT probed: every endpoint that would accept it
// creates an import row, and a diagnostic must not write data. It is verified
// by the first real sync.

import { ApiClient } from '../client.js';
import { configPath, readConfig, type ConnectorConfig } from '../config.js';
import { ConnectorError, EXIT_API, EXIT_OK } from '../errors.js';
import { writeLine } from '../output.js';
import { BANK_TIMEZONE, findBrowser } from '../scrape.js';

interface CheckOutcome {
  ok: boolean;
  exitCode?: number;
}

async function check(label: string, run: () => Promise<string>): Promise<CheckOutcome> {
  try {
    writeLine(`  ok    ${label}: ${await run()}`);
    return { ok: true };
  } catch (error) {
    const connectorError = error instanceof ConnectorError ? error : null;
    writeLine(`  FAIL  ${label}: ${(error as Error).message}`);
    if (connectorError?.hint) writeLine(`        ${connectorError.hint}`);
    return { ok: false, exitCode: connectorError?.exitCode };
  }
}

export async function runDoctor(): Promise<number> {
  writeLine('MyFinPro connector — checks');

  let config: ConnectorConfig | null = null;
  const outcomes: CheckOutcome[] = [];

  outcomes.push(
    await check('config', async () => {
      config = await readConfig();
      const path = configPath();
      const profiles = config.profiles.length;
      const mapped = config.profiles.reduce((total, profile) => total + profile.accounts.length, 0);
      return `${path} — ${profiles} profile(s), ${mapped} mapped account(s), permissions 0600`;
    }),
  );

  outcomes.push(await check('browser', async () => await findBrowser()));

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timezone === BANK_TIMEZONE) {
    writeLine(`  ok    timezone: ${timezone}`);
  } else {
    writeLine(`  warn  timezone: ${timezone} — dates are read in this zone, not ${BANK_TIMEZONE}`);
    writeLine(`        Run the connector with TZ=${BANK_TIMEZONE} to match the bank's dates.`);
  }

  if (config) {
    const { appUrl, token } = config as ConnectorConfig;
    const client = new ApiClient({ appUrl, token });
    const reachable = await client.health();
    writeLine(
      reachable
        ? `  ok    app: ${appUrl} answers`
        : `  FAIL  app: ${appUrl} did not answer /api/v1/health`,
    );
    if (!reachable) outcomes.push({ ok: false, exitCode: EXIT_API });
    writeLine('  info  token: checked by the app on the first sync (no read-only route exists)');
  }

  const failed = outcomes.find((outcome) => !outcome.ok);
  if (!failed) {
    writeLine('');
    writeLine('All checks passed. Next: myfinpro-connector sync --dry-run');
    return EXIT_OK;
  }
  return failed.exitCode ?? 1;
}
