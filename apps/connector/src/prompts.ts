// Phase 20 · Iteration 20.7 — the questions `init` asks.
//
// No secret is ever a command-line argument (it would land in the shell
// history and in `ps`), so the token and every bank password are TYPED at a
// prompt — and typed with the echo off: `askSecret` puts the terminal in raw
// mode and prints nothing, not even asterisks whose count is a hint.

import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { ConnectorError, EXIT_USAGE } from './errors.js';

// Written as escape sequences on purpose: the literal characters are
// invisible, which would make this file undiffable (the shared statement
// normaliser states the same rule).
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\u0008', '\u007F']);

const cancelled = (): ConnectorError => new ConnectorError(EXIT_USAGE, 'Cancelled.');

/** A visible question. `fallback` is offered as the answer to an empty line. */
export async function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY ?? false });
  try {
    const suffix = fallback ? ` [${fallback}]` : '';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || fallback || '';
  } finally {
    rl.close();
  }
}

/** Asks until the answer is non-empty (or a fallback applies). */
export async function askRequired(question: string, fallback?: string): Promise<string> {
  for (;;) {
    const answer = await ask(question, fallback);
    if (answer) return answer;
    stdout.write('  A value is required.\n');
  }
}

export async function askYesNo(question: string, fallback = false): Promise<boolean> {
  for (;;) {
    const answer = (await ask(`${question} (y/n)`, fallback ? 'y' : 'n')).toLowerCase();
    if (['y', 'yes'].includes(answer)) return true;
    if (['n', 'no'].includes(answer)) return false;
    stdout.write('  Answer y or n.\n');
  }
}

/**
 * A question whose answer is never echoed. Outside a TTY (a piped test or a
 * here-doc) there is nothing to hide from a terminal, so the line is read
 * normally — the value still only ever reaches the config file.
 */
export async function askSecret(question: string, allowEmpty = false): Promise<string> {
  for (;;) {
    const value = stdin.isTTY ? await readHidden(`${question}: `) : await ask(question);
    if (value || allowEmpty) return value;
    stdout.write('  A value is required.\n');
  }
}

function readHidden(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    stdout.write(prompt);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n' || character === CTRL_D) {
          cleanup();
          resolve(value);
          return;
        }
        if (character === CTRL_C) {
          cleanup();
          reject(cancelled());
          return;
        }
        if (BACKSPACE.has(character)) {
          value = value.slice(0, -1);
          continue;
        }
        // Printable characters only: no escape sequence becomes part of a
        // password, and nothing is echoed.
        if (character >= ' ') value += character;
      }
    };

    stdin.on('data', onData);
  });
}
