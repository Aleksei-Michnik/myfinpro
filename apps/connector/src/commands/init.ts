// Phase 20 · Iteration 20.7 — `myfinpro-connector init`.
//
// Asks for everything the connector needs and writes it 0600 to the user's own
// machine: the app address, the `accounts:import` token, and one profile per
// institution with exactly the login fields israeli-bank-scrapers declares for
// it. Nothing typed here is echoed, logged or printed back.

import {
  companyName,
  isCompanyId,
  listCompanies,
  loginFieldsFor,
  OPTIONAL_LOGIN_FIELDS,
  SECRET_LOGIN_FIELDS,
  UNPROMPTABLE_LOGIN_FIELDS,
  type CompanyId,
} from '../companies.js';
import {
  checkToken,
  configPath,
  lastFourOf,
  normalizeAppUrl,
  readConfig,
  writeConfig,
  CONFIG_VERSION,
  type ConnectorConfig,
  type ConnectorProfile,
  type ProfileAccountMapping,
} from '../config.js';
import { ConnectorError, configError, EXIT_OK } from '../errors.js';
import { writeLine } from '../output.js';
import { ask, askRequired, askSecret, askYesNo } from '../prompts.js';

const UUID_HINT = 'The id in the account page address: /accounts/<this part>';

async function existingConfig(path: string): Promise<ConnectorConfig | null> {
  try {
    return await readConfig(path);
  } catch (error) {
    // A file that exists but is unreadable or wrongly permissioned is a
    // problem to fix, not to silently overwrite.
    if (error instanceof ConnectorError && error.message.startsWith('No config file')) return null;
    throw error;
  }
}

async function askAppUrl(fallback?: string): Promise<string> {
  for (;;) {
    const answer = await askRequired('MyFinPro address (https://…)', fallback);
    try {
      return normalizeAppUrl(answer);
    } catch (error) {
      writeLine(`  ${(error as Error).message}`);
    }
  }
}

async function askToken(hasExisting: boolean): Promise<string | null> {
  for (;;) {
    const question = hasExisting
      ? 'API token (paste it; leave empty to keep the current one)'
      : 'API token (paste it — it is not shown)';
    const answer = await askSecret(question, hasExisting);
    if (!answer) return null;
    try {
      const { token, warning } = checkToken(answer);
      if (warning) writeLine(`  ${warning}`);
      return token;
    } catch (error) {
      writeLine(`  ${(error as Error).message}`);
    }
  }
}

async function askCompany(): Promise<CompanyId> {
  writeLine('Institutions the installed scraper library supports:');
  writeLine(listCompanies());
  for (;;) {
    const answer = await askRequired('Company id');
    if (isCompanyId(answer)) return answer;
    writeLine(`  "${answer}" is not one of the ids above.`);
  }
}

async function askCredentials(companyId: CompanyId): Promise<Record<string, string>> {
  const credentials: Record<string, string> = {};
  writeLine(`${companyName(companyId)} asks for: ${loginFieldsFor(companyId).join(', ')}`);
  for (const field of loginFieldsFor(companyId)) {
    if (UNPROMPTABLE_LOGIN_FIELDS.has(field)) {
      writeLine(`  "${field}" is an interactive callback — skipped (see the README).`);
      continue;
    }
    const optional = OPTIONAL_LOGIN_FIELDS.has(field);
    const label = `  ${field}${optional ? ' (optional)' : ''}`;
    const value = SECRET_LOGIN_FIELDS.has(field)
      ? await askSecret(label, optional)
      : optional
        ? await ask(label)
        : await askRequired(label);
    if (value) credentials[field] = value;
  }
  return credentials;
}

async function askAccountMappings(
  existing: ProfileAccountMapping[],
): Promise<ProfileAccountMapping[]> {
  const mappings = [...existing];
  writeLine('');
  writeLine('Each scraped account needs the MyFinPro account its lines belong to.');
  writeLine('You can leave this empty now, run `myfinpro-connector accounts` to see the');
  writeLine('account numbers, and run `init` again to fill them in.');

  for (;;) {
    if (!(await askYesNo('Map an account now?', mappings.length === 0))) break;
    const last4 = lastFourOf(await askRequired('  Last digits of the bank account / card'));
    if (last4.length < 2) {
      writeLine('  Give at least the last two digits.');
      continue;
    }
    writeLine(`  ${UUID_HINT}`);
    const accountId = await askRequired('  MyFinPro account id');
    const index = mappings.findIndex((mapping) => mapping.last4 === last4);
    if (index >= 0) mappings[index] = { last4, accountId };
    else mappings.push({ last4, accountId });
  }
  return mappings;
}

async function askProfile(existing: ConnectorProfile[]): Promise<ConnectorProfile> {
  const companyId = await askCompany();
  const name = await askRequired('Profile name', companyId);
  const previous = existing.find((profile) => profile.name === name);
  if (previous) writeLine(`  Replacing the existing profile "${name}".`);
  const credentials = await askCredentials(companyId);
  const accounts = await askAccountMappings(previous?.accounts ?? []);
  return { name, companyId, credentials, accounts };
}

export async function runInit(): Promise<number> {
  const path = configPath();
  const current = await existingConfig(path);

  writeLine('MyFinPro connector — setup');
  writeLine(`Config file: ${path}`);
  writeLine('');

  const appUrl = await askAppUrl(current?.appUrl);
  const token = (await askToken(Boolean(current))) ?? current?.token;
  if (!token) throw configError('No token was given.');

  const profiles = [...(current?.profiles ?? [])];
  for (;;) {
    const first = profiles.length === 0;
    if (!first && !(await askYesNo('Add or replace a bank profile?', false))) break;
    if (first) writeLine('');
    const profile = await askProfile(profiles);
    const index = profiles.findIndex((candidate) => candidate.name === profile.name);
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
    writeLine('');
  }

  await writeConfig({ version: CONFIG_VERSION, appUrl, token, profiles }, path);

  writeLine(`Saved ${path} (readable by you only).`);
  const unmapped = profiles.filter((profile) => profile.accounts.length === 0);
  if (unmapped.length > 0) {
    writeLine('');
    writeLine('These profiles have no account mapping yet:');
    for (const profile of unmapped) writeLine(`  ${profile.name}`);
    writeLine('Run: myfinpro-connector accounts   then: myfinpro-connector init');
  } else {
    writeLine('Next: myfinpro-connector sync --dry-run');
  }
  return EXIT_OK;
}
