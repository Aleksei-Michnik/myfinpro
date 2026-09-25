// Phase 20 · Iteration 20.7 — argument parsing and dispatch.
//
// Four commands, three flags, no secret among them: a token or a password on a
// command line lands in the shell history and in `ps`, so `init` asks for them
// instead (20.7 UI spec, "never type it into the command itself").

import { runAccounts } from './commands/accounts.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runSync } from './commands/sync.js';
import { EXIT_OK, usageError } from './errors.js';
import { writeLine } from './output.js';

export const COMMANDS = ['init', 'sync', 'accounts', 'doctor', 'help'] as const;
export type Command = (typeof COMMANDS)[number];

export interface ParsedArgs {
  command: Command;
  since?: string;
  dryRun: boolean;
  profile?: string;
}

export const USAGE = `MyFinPro connector — push your own bank lines into MyFinPro.

Usage: myfinpro-connector <command> [options]

Commands:
  init                 ask for the app address, the token and your bank profiles
  sync                 scrape, map and import; the everyday command
  accounts             list the scraped accounts of a profile, to map them
  doctor               check the config, the browser and the app
  help                 this text

Options:
  --since YYYY-MM-DD   scrape from this date (default: 60 days back)
  --dry-run            map and count, send nothing
  --profile <name>     one profile instead of all of them

Neither the token nor a bank password is ever an argument: init asks for them.`;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = [...argv];
  const parsed: ParsedArgs = { command: 'help', dryRun: false };

  const wantsHelp = args.includes('--help') || args.includes('-h');
  const first = args.shift();
  if (first === undefined || wantsHelp) return parsed;

  if (!(COMMANDS as readonly string[]).includes(first)) {
    throw usageError(`Unknown command "${first}".`, `Run: myfinpro-connector help`);
  }
  parsed.command = first as Command;

  while (args.length > 0) {
    const flag = args.shift() as string;
    switch (flag) {
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--since':
        parsed.since = requireValue(flag, args.shift());
        break;
      case '--profile':
        parsed.profile = requireValue(flag, args.shift());
        break;
      case '--help':
      case '-h':
        parsed.command = 'help';
        break;
      default:
        throw usageError(`Unknown option "${flag}".`, 'Run: myfinpro-connector help');
    }
  }
  return parsed;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw usageError(`Option "${flag}" needs a value.`);
  }
  return value;
}

export async function run(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  switch (args.command) {
    case 'init':
      return runInit();
    case 'sync':
      return runSync({ since: args.since, dryRun: args.dryRun, profile: args.profile });
    case 'accounts':
      return runAccounts({ since: args.since, profile: args.profile });
    case 'doctor':
      return runDoctor();
    case 'help':
      writeLine(USAGE);
      return EXIT_OK;
  }
}
