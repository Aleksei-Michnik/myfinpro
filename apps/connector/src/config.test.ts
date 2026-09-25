import { mkdtemp, chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkToken,
  configPath,
  lastFourOf,
  normalizeAppUrl,
  parseConfig,
  readConfig,
  selectProfiles,
  writeConfig,
  CONFIG_VERSION,
  type ConnectorConfig,
} from './config.js';
import { EXIT_CONFIG, ConnectorError } from './errors.js';

const TOKEN = 'mfp_0123456789abcdef0123456789';
const PASSWORD = 'hunter2-not-a-real-password';
const ACCOUNT_ID = '3f1d0f1a-9b1e-4c2a-8f3d-6a7b8c9d0e1f';

function validConfig(): ConnectorConfig {
  return {
    version: CONFIG_VERSION,
    appUrl: 'https://app.example.com',
    token: TOKEN,
    profiles: [
      {
        name: 'bank',
        companyId: 'hapoalim',
        credentials: { userCode: 'user-code', password: PASSWORD },
        accounts: [{ last4: '1234', accountId: ACCOUNT_ID }],
      },
    ],
  };
}

function expectConfigError(run: () => unknown): ConnectorError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).exitCode).toBe(EXIT_CONFIG);
    return error as ConnectorError;
  }
  throw new Error('expected a config error');
}

describe('normalizeAppUrl', () => {
  it('accepts https and drops a trailing slash', () => {
    expect(normalizeAppUrl('https://app.example.com/')).toBe('https://app.example.com');
  });

  it('allows plain http for a local machine only', () => {
    expect(normalizeAppUrl('http://localhost:3001')).toBe('http://localhost:3001');
    expectConfigError(() => normalizeAppUrl('http://app.example.com'));
  });

  it('refuses a path, a query and anything that is not a URL', () => {
    expectConfigError(() => normalizeAppUrl('https://app.example.com/accounts'));
    expectConfigError(() => normalizeAppUrl('https://app.example.com/?a=1'));
    expectConfigError(() => normalizeAppUrl('app.example.com'));
    expectConfigError(() => normalizeAppUrl('  '));
  });
});

describe('checkToken', () => {
  it('accepts the app format', () => {
    expect(checkToken(` ${TOKEN} `)).toEqual({ token: TOKEN });
  });

  it('warns, but does not refuse, an unexpected prefix', () => {
    const result = checkToken('xyz_0123456789abcdef0123456789');
    expect(result.warning).toContain('mfp_');
  });

  it('refuses an empty, short or whitespace-carrying value', () => {
    expectConfigError(() => checkToken(''));
    expectConfigError(() => checkToken('mfp_short'));
    expectConfigError(() => checkToken('mfp_0123456789 abcdef0123456789'));
  });

  it('never puts the token in the message', () => {
    const error = expectConfigError(() => checkToken('mfp_0123456789 abcdef0123456789'));
    expect(error.message).not.toContain('0123456789');
  });
});

describe('lastFourOf', () => {
  it('keeps the last four digits only', () => {
    expect(lastFourOf('12-345-67890')).toBe('7890');
    expect(lastFourOf('**** 0423')).toBe('0423');
    expect(lastFourOf('')).toBe('');
  });
});

describe('parseConfig', () => {
  it('accepts a valid file', () => {
    expect(parseConfig(validConfig())).toEqual(validConfig());
  });

  it('refuses a file with no profiles', () => {
    expectConfigError(() => parseConfig({ ...validConfig(), profiles: [] }));
  });

  it('refuses an account id that is not a uuid and a bad last4', () => {
    const bad = validConfig();
    bad.profiles[0].accounts = [{ last4: '1234', accountId: 'not-a-uuid' }];
    expectConfigError(() => parseConfig(bad));

    const worse = validConfig();
    worse.profiles[0].accounts = [{ last4: 'abcd', accountId: ACCOUNT_ID }];
    expectConfigError(() => parseConfig(worse));
  });

  it('refuses two profiles with one name', () => {
    const config = validConfig();
    config.profiles = [config.profiles[0], { ...config.profiles[0] }];
    expectConfigError(() => parseConfig(config));
  });

  it('names the field, never the credential, when one is wrong', () => {
    const config = validConfig();
    (config.profiles[0].credentials as Record<string, unknown>).password = 42;
    const error = expectConfigError(() => parseConfig(config));
    expect(error.message).toContain('profiles[0].credentials.password');
    expect(error.message).not.toContain('42');
  });

  it('refuses a config written by a newer connector', () => {
    expectConfigError(() => parseConfig({ ...validConfig(), version: CONFIG_VERSION + 1 }));
  });
});

describe('selectProfiles', () => {
  it('returns every profile, or the named one', () => {
    const config = validConfig();
    expect(selectProfiles(config)).toHaveLength(1);
    expect(selectProfiles(config, 'bank')[0].name).toBe('bank');
    expectConfigError(() => selectProfiles(config, 'nope'));
  });
});

describe('the config file on disk', () => {
  let directory: string;
  let path: string;
  const previousOverride = process.env.MYFINPRO_CONNECTOR_CONFIG;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'myfinpro-connector-'));
    path = join(directory, 'config.json');
  });

  afterEach(() => {
    if (previousOverride === undefined) delete process.env.MYFINPRO_CONNECTOR_CONFIG;
    else process.env.MYFINPRO_CONNECTOR_CONFIG = previousOverride;
  });

  it('is written 0600 and read back', async () => {
    await writeConfig(validConfig(), path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readConfig(path)).toEqual(validConfig());
  });

  it('refuses a config other users can read', async () => {
    await writeConfig(validConfig(), path);
    await chmod(path, 0o644);
    await expect(readConfig(path)).rejects.toMatchObject({
      exitCode: EXIT_CONFIG,
      hint: expect.stringContaining('chmod 600'),
    });
  });

  it('says how to create a config that is not there', async () => {
    await expect(readConfig(join(directory, 'absent.json'))).rejects.toMatchObject({
      exitCode: EXIT_CONFIG,
      hint: expect.stringContaining('init'),
    });
  });

  it('never echoes the file when its JSON is broken', async () => {
    await writeFile(path, `{ "token": "${TOKEN}" `, { mode: 0o600 });
    const error = await readConfig(path).catch((caught: ConnectorError) => caught);
    expect((error as ConnectorError).exitCode).toBe(EXIT_CONFIG);
    expect((error as ConnectorError).message).not.toContain(TOKEN);
  });

  it('leaves no readable temporary file behind', async () => {
    await writeConfig(validConfig(), path);
    await expect(stat(`${path}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path, 'utf8')).toContain('"version": 1');
  });

  it('honours the path override', () => {
    process.env.MYFINPRO_CONNECTOR_CONFIG = path;
    expect(configPath()).toBe(path);
  });
});
