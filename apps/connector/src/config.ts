// Phase 20 · Iteration 20.7 — the connector's local configuration.
//
// This file is the only place bank credentials and the API token exist, and
// it lives on the user's own machine (design §3.5, channel B). Two rules
// follow and are enforced here:
//
//   1. The file is created 0600 and REFUSED when it is group- or
//      world-readable — a config a housemate can read is the same leak as a
//      password on the server, which this whole channel exists to avoid.
//   2. No validation message, and no error thrown from here, may contain a
//      credential, a token or any part of one. Messages name the FIELD.

import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ACCOUNT_LAST4_PATTERN } from '@myfinpro/shared';
import { configError } from './errors.js';

export const CONFIG_DIR_NAME = 'myfinpro-connector';
export const CONFIG_FILE_NAME = 'config.json';
/** Bumped only when the file's shape changes in a way `init` must migrate. */
export const CONFIG_VERSION = 1;

/** What a token the app issues looks like (20.7 UI spec, §4 Panel B). */
export const TOKEN_PREFIX = 'mfp_';
/** Shortest value that can plausibly be a token — a typo fence, not a check. */
export const TOKEN_MIN_LENGTH = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Hosts for which plain http is allowed: a developer's own machine only. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** Mode bits that must be clear: anything readable outside the owner. */
const GROUP_AND_WORLD_BITS = 0o077;

/** One scraped account bound to the MyFinPro account its lines belong to. */
export interface ProfileAccountMapping {
  /** Last 2–4 digits of the scraped `accountNumber` — never the full number. */
  last4: string;
  /** The MyFinPro account id (uuid) the lines are imported into. */
  accountId: string;
}

export interface ConnectorProfile {
  /** The user's own label, unique in the file; `--profile` selects by it. */
  name: string;
  /** A `CompanyTypes` value of israeli-bank-scrapers. */
  companyId: string;
  /** Exactly the login fields the library declares for `companyId`. */
  credentials: Record<string, string>;
  accounts: ProfileAccountMapping[];
}

export interface ConnectorConfig {
  version: number;
  /** Origin of the MyFinPro app, without a trailing slash. */
  appUrl: string;
  /** The `accounts:import` personal access token (design §6.4). */
  token: string;
  profiles: ConnectorProfile[];
}

/** `$XDG_CONFIG_HOME/myfinpro-connector` or `~/.config/myfinpro-connector`. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, CONFIG_DIR_NAME);
}

/** `MYFINPRO_CONNECTOR_CONFIG` overrides the path (tests, multiple users). */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.MYFINPRO_CONNECTOR_CONFIG?.trim() || join(configDir(env), CONFIG_FILE_NAME);
}

/**
 * The app's origin: https everywhere, http only against a local machine.
 * Returns the normalised origin (no trailing slash, no path, query or hash) —
 * the client appends the API path to it.
 */
export function normalizeAppUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw configError('The app URL is empty.');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configError(`"${value}" is not a URL.`, 'Example: https://app.example.com');
  }

  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw configError(
      'The app URL must use https (http is allowed for localhost only).',
      'Your token travels on every request — plain http would expose it.',
    );
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw configError('The app URL must be just the address, with no path or query.');
  }
  return url.origin;
}

/**
 * Shape check only — the app decides whether a token is valid, on the first
 * real request. A value that does not carry the expected prefix is accepted
 * with a warning rather than refused, so a future prefix cannot lock a user
 * out of their own connector. The value is never part of the return.
 */
export function checkToken(raw: string): { token: string; warning?: string } {
  const token = raw.trim();
  if (!token) throw configError('The token is empty.');
  if (/\s/.test(token)) {
    throw configError(
      'The token contains whitespace.',
      'Paste it exactly as the app showed it, with nothing around it.',
    );
  }
  if (token.length < TOKEN_MIN_LENGTH) {
    throw configError('The token is too short to be a MyFinPro token.');
  }
  return token.startsWith(TOKEN_PREFIX)
    ? { token }
    : {
        token,
        warning: `The token does not start with "${TOKEN_PREFIX}" — check you pasted all of it.`,
      };
}

/** Digits of a scraped account number, last four at most (design §9). */
export function lastFourOf(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '');
  return digits.slice(-4);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw configError(`Config field "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function parseProfile(raw: unknown, index: number): ConnectorProfile {
  const at = `profiles[${index}]`;
  if (typeof raw !== 'object' || raw === null) {
    throw configError(`Config field "${at}" must be an object.`);
  }
  const value = raw as Record<string, unknown>;
  const name = requireString(value.name, `${at}.name`);
  const companyId = requireString(value.companyId, `${at}.companyId`);

  if (typeof value.credentials !== 'object' || value.credentials === null) {
    throw configError(`Config field "${at}.credentials" must be an object.`);
  }
  const credentials: Record<string, string> = {};
  for (const [field, credential] of Object.entries(value.credentials as Record<string, unknown>)) {
    if (typeof credential !== 'string' || credential === '') {
      // The FIELD name only — never the value, not even its length.
      throw configError(`Config field "${at}.credentials.${field}" must be a non-empty string.`);
    }
    credentials[field] = credential;
  }
  if (Object.keys(credentials).length === 0) {
    throw configError(`Config field "${at}.credentials" has no fields.`);
  }

  const rawAccounts = value.accounts ?? [];
  if (!Array.isArray(rawAccounts)) {
    throw configError(`Config field "${at}.accounts" must be an array.`);
  }
  const accounts = rawAccounts.map((entry, accountIndex) => {
    const path = `${at}.accounts[${accountIndex}]`;
    if (typeof entry !== 'object' || entry === null) {
      throw configError(`Config field "${path}" must be an object.`);
    }
    const account = entry as Record<string, unknown>;
    const last4 = requireString(account.last4, `${path}.last4`);
    if (!ACCOUNT_LAST4_PATTERN.test(last4)) {
      throw configError(`Config field "${path}.last4" must be 2 to 4 digits.`);
    }
    const accountId = requireString(account.accountId, `${path}.accountId`);
    if (!UUID_PATTERN.test(accountId)) {
      throw configError(`Config field "${path}.accountId" must be a MyFinPro account id (uuid).`);
    }
    return { last4, accountId };
  });

  return { name, companyId, credentials, accounts };
}

/** Validates a parsed JSON value into a `ConnectorConfig`, or throws (exit 2). */
export function parseConfig(raw: unknown): ConnectorConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw configError('The config file must contain a JSON object.');
  }
  const value = raw as Record<string, unknown>;

  const version = value.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw configError('Config field "version" must be a positive integer.');
  }
  if (version > CONFIG_VERSION) {
    throw configError(
      `The config was written by a newer connector (version ${version}).`,
      'Update the connector, or run init again to rewrite it.',
    );
  }

  const appUrl = normalizeAppUrl(requireString(value.appUrl, 'appUrl'));
  const { token } = checkToken(requireString(value.token, 'token'));

  if (!Array.isArray(value.profiles) || value.profiles.length === 0) {
    throw configError(
      'Config field "profiles" must list at least one bank profile.',
      'Run: myfinpro-connector init',
    );
  }
  const profiles = value.profiles.map(parseProfile);

  const names = new Set<string>();
  for (const profile of profiles) {
    if (names.has(profile.name)) {
      throw configError(`Two profiles are both named "${profile.name}".`);
    }
    names.add(profile.name);
  }

  return { version, appUrl, token, profiles };
}

/**
 * Refuses a config other users can read. Windows has no POSIX mode bits, so
 * the check is skipped there and the README says so.
 */
export async function assertPrivateFile(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const info = await stat(path);
  if ((info.mode & GROUP_AND_WORLD_BITS) !== 0) {
    throw configError(
      `The config file is readable by other users: ${path}`,
      `Fix it with: chmod 600 ${path}`,
    );
  }
}

/** Reads, permission-checks and validates the config; every failure is exit 2. */
export async function readConfig(path = configPath()): Promise<ConnectorConfig> {
  let contents: string;
  try {
    await assertPrivateFile(path);
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw configError(`No config file at ${path}.`, 'Run: myfinpro-connector init');
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    // Never echo the file: it holds the credentials.
    throw configError(`The config file is not valid JSON: ${path}`);
  }
  return parseConfig(parsed);
}

/**
 * Writes the config 0600, atomically: a temporary file in the same directory,
 * created with the final mode, then renamed over the target. A crash mid-write
 * therefore never leaves a half-written — or world-readable — credential file.
 */
export async function writeConfig(config: ConnectorConfig, path = configPath()): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

/** The profile `--profile` selected, or the only one when there is one. */
export function selectProfiles(config: ConnectorConfig, name?: string): ConnectorProfile[] {
  if (!name) return config.profiles;
  const profile = config.profiles.find((candidate) => candidate.name === name);
  if (!profile) {
    throw configError(
      `No profile named "${name}" in the config.`,
      `Known profiles: ${config.profiles.map((candidate) => candidate.name).join(', ')}`,
    );
  }
  return [profile];
}

/**
 * The mapping a scraped account number belongs to: the stored digits must end
 * the number. Two mappings that both fit are a configuration error — lines
 * must never land on a guessed account (security review, finding 5).
 */
export function findAccountMapping(
  profile: Pick<ConnectorProfile, 'name' | 'accounts'>,
  accountNumber: string,
): { accountId: string; last4: string } | null {
  const last4 = lastFourOf(accountNumber);
  if (last4 === '') return null;
  const matches = profile.accounts.filter((candidate) => last4.endsWith(candidate.last4));
  if (matches.length > 1) {
    throw configError(
      `More than one mapping of profile "${profile.name}" matches account ••${last4} — give each mapping the full last four digits`,
    );
  }
  return matches[0] ? { accountId: matches[0].accountId, last4 } : null;
}
