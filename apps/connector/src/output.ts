// Phase 20 · Iteration 20.7 — everything the connector prints.
//
// `console.log` is linted off in this repo and a CLI has to write to stdout,
// so the streams are used directly. Nothing here formats a credential: the
// callers only ever hand it counts, dates, masked identifiers and the app's
// own error codes.

/** One line to stdout — the command's result, safe to pipe. */
export function writeLine(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** One line to stderr — diagnostics, warnings and failures. */
export function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** `1 234,50 ILS` style is locale work; the CLI stays plain and unambiguous. */
export function formatAmount(cents: number, currency: string): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const major = Math.trunc(absolute / 100);
  const minor = String(absolute % 100).padStart(2, '0');
  return `${sign}${major}.${minor} ${currency}`;
}

/** Right-pads a column so the per-account report lines up in a terminal. */
export function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}
