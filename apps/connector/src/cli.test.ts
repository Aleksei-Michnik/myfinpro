import { describe, expect, it } from 'vitest';
import { parseArgs, USAGE } from './cli.js';
import { EXIT_USAGE } from './errors.js';

function expectUsageError(argv: string[]): void {
  expect(() => parseArgs(argv)).toThrowError(
    expect.objectContaining({ exitCode: EXIT_USAGE }) as unknown as Error,
  );
}

describe('parseArgs', () => {
  it('falls back to help with no arguments or --help', () => {
    expect(parseArgs([])).toEqual({ command: 'help', dryRun: false });
    expect(parseArgs(['sync', '--help']).command).toBe('help');
    expect(parseArgs(['-h']).command).toBe('help');
  });

  it('reads the sync flags', () => {
    expect(parseArgs(['sync', '--since', '2026-09-01', '--dry-run', '--profile', 'bank'])).toEqual({
      command: 'sync',
      since: '2026-09-01',
      dryRun: true,
      profile: 'bank',
    });
  });

  it('refuses an unknown command or option, and a flag with no value', () => {
    expectUsageError(['scrape']);
    expectUsageError(['sync', '--everything']);
    expectUsageError(['sync', '--since']);
    expectUsageError(['sync', '--profile', '--dry-run']);
  });

  it('documents that no secret is ever an argument', () => {
    expect(USAGE).toContain('is ever an argument');
    expect(USAGE).not.toMatch(/--token|--password/);
  });
});
