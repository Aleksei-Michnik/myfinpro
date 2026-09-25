#!/usr/bin/env node
// Phase 20 · Iteration 20.7 — the connector's entry point.
//
// The user-run half of bank sync (design §3.5, channel B): bank credentials
// live on this machine and only normalised statement lines leave it. The exit
// code is the contract a scheduler reads — see `errors.ts`.

import { run } from './cli.js';
import { ConnectorError } from './errors.js';
import { writeError } from './output.js';

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  if (error instanceof ConnectorError) {
    writeError(error.message);
    if (error.hint) writeError(error.hint);
    process.exitCode = error.exitCode;
  } else {
    // Never print a stack with a scraped page or a credential in it.
    writeError(error instanceof Error ? error.message : 'Unexpected failure.');
    process.exitCode = 1;
  }
}
