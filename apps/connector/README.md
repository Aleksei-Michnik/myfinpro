# @myfinpro/connector

A small program **you** run on **your own computer**. It signs in to your bank or card issuer with
[`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers), turns what it finds
into MyFinPro statement lines, and sends only those lines to the app.

The app never learns your bank password. There is no endpoint that could accept one — that is the
point of this channel (design §3.5, channel B). The alternative, and the recommended default for
most people, is downloading a statement from the bank's site and importing the file in the app;
that parses in your browser and never uploads the file either.

| Where it runs    | Your machine                                                   |
| ---------------- | -------------------------------------------------------------- |
| Bank credentials | Your machine only, in a file only you can read                 |
| Sent to the app  | Normalised statement lines, with an `accounts:import` token    |
| Never sent       | Passwords, one-time codes, files, full account or card numbers |

## Requirements

- Node 26 or newer (`node --version`).
- A browser for the scrapers, installed once:

  ```bash
  npx puppeteer browsers install chrome
  ```

  The install of this package deliberately does **not** download a browser (pnpm blocks puppeteer's
  install script), so this is a separate, visible step. If you skip it, every `sync` stops with
  "No browser for the scrapers is installed" and repeats the command above.

- A connector token from the app: **Settings → Connector tokens → New token**. It starts with
  `mfp_`, is shown once, and can do exactly one thing: import statement lines.

## Install

The package is not published yet. Inside this repository:

```bash
pnpm --filter @myfinpro/connector build
node apps/connector/dist/main.js help
```

The token dialog and the Help page print these same in-repo commands. Publishing the package (so
that an `npx` line works) is a release decision: the npm scope must be owned first, otherwise a
printed `npx @myfinpro/connector` would run whatever a squatter publishes under that name.

The examples below use `myfinpro-connector`, the name of the installed command.

## Set it up

```bash
myfinpro-connector init
```

`init` asks, in order:

1. **The MyFinPro address** — `https://…`. Plain `http` is refused unless it is `localhost`: your
   token travels on every request.
2. **The token** — pasted at the prompt, with the echo off. Never pass a token as a command-line
   argument: arguments land in your shell history and are visible to every process on the machine
   (`ps`). No command of this connector takes one.
3. **One profile per institution** — the company id (`hapoalim`, `leumi`, `isracard`, `visaCal`,
   `max`, …; `init` lists the ones your installed library supports), a name for the profile, and
   then exactly the login fields that library declares for that company (`userCode`, `id`,
   `password`, `card6Digits`, `num`, …). Passwords are typed with the echo off.
4. **Which MyFinPro account each scraped account belongs to** — the last digits of the bank account
   or card, and the account's id in MyFinPro (the last part of the address of its page:
   `/accounts/<id>`). You can leave this empty, run `myfinpro-connector accounts` to see the
   numbers, and run `init` again.

Run `init` again at any time: it keeps what you already answered (press Enter to keep the address,
leave the token empty to keep the current one) and adds or replaces a profile.

**OTP-protected institutions.** Where the library asks for an interactive one-time-code callback
(OneZero's `otpCodeRetriever`), the connector cannot prompt for it in a scheduled run and skips that
field; supply the library's long-term token (`otpLongTermToken`) instead if you have one.

## Everyday use

```bash
myfinpro-connector sync                     # the last 60 days, every profile
myfinpro-connector sync --since 2026-09-01  # from a date
myfinpro-connector sync --profile card      # one profile
myfinpro-connector sync --dry-run           # map and count, send nothing
myfinpro-connector accounts                 # list the scraped accounts, to map them
myfinpro-connector doctor                   # check the config, the browser and the app
```

`sync` prints, per scraped account: how much was scraped, how many lines it made, the balance the
bank reports, how many lines the app inserted, how many it already had (duplicates are normal and
safe — re-running is idempotent), how many still need a decision, and the address of the account's
**Review** tab.

Besides the lines, an import carries the period it covers (from the effective `--since` date to
today) and, once per account, the balance the bank reported, so the app can show the gap between
its own ledger and the bank's number. Nothing else is sent. Imported lines are not
transactions yet: you accept, match or ignore them there, exactly like a file import.

`--dry-run` additionally prints the first three mapped lines with their amounts, so you can see the
mapping is right before anything is sent. It never prints a credential.

### Scheduling

Use your own scheduler; the connector has none by design.

- **Linux / macOS** — `crontab -e`:

  ```cron
  30 6 * * * TZ=Asia/Jerusalem /usr/bin/node /path/to/connector/dist/main.js sync >> $HOME/.local/state/myfinpro-connector.log 2>&1
  ```

- **macOS** — a `launchd` agent running the same command.
- **Windows** — Task Scheduler, action `node`, argument `…\dist\main.js sync`.

Set `TZ=Asia/Jerusalem` (or run on a machine in that timezone): the scrapers report dates as
instants, and the connector reads them in the machine's timezone. `doctor` warns when it differs.

A scheduled run is judged by its **exit code**:

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| 0    | Done                                                                        |
| 1    | Wrong command line                                                          |
| 2    | Config problem (missing, wrongly permissioned, invalid, nothing mapped)     |
| 3    | The scrape failed (password, one-time code, changed bank site, no browser)  |
| 4    | The app rejected the import (401 → the token was revoked; run `init` again) |

## Where your credentials live

`~/.config/myfinpro-connector/config.json` (`$XDG_CONFIG_HOME` is honoured; set
`MYFINPRO_CONNECTOR_CONFIG` to use another path). It is written with mode `0600` — readable by you
only — and the connector **refuses to run** on a config any other user can read, telling you to
`chmod 600` it. Windows has no such mode bits; on Windows, keep the file in your own profile
directory. Nothing in the file is ever printed, logged or sent anywhere except the token, which is
sent to your MyFinPro address as a bearer token, and the credentials, which go only to the bank.

## What the token can and cannot do

It can add statement lines to an account you can already see. It cannot read your transactions,
change anything, create accounts, see other people's data, or sign in to the app. A leaked token can
therefore add noise to your review queue, and nothing else.

**To revoke it**: Settings → Connector tokens → Revoke. The next `sync` stops with exit code 4 and
"the app refused the token". Create a new token and run `init` again to store it. Use one token per
machine and give it an expiry.

## Development

```bash
pnpm --filter @myfinpro/connector typecheck
pnpm --filter @myfinpro/connector lint
pnpm --filter @myfinpro/connector test
pnpm --filter @myfinpro/connector build
```

The tests never scrape: a real bank login is out of scope for automated tests. They cover the
mapper, the config loader and its permission rule, the company → import-source mapping, the date
arithmetic, and the HTTP client against a mocked `fetch`.

| File               | What                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| `src/main.ts`      | entry point; turns a failure into its exit code                               |
| `src/cli.ts`       | commands, flags, usage                                                        |
| `src/config.ts`    | the local config: schema, `0600`, atomic write                                |
| `src/prompts.ts`   | the questions `init` asks, secrets with the echo off                          |
| `src/companies.ts` | login fields and display names read from the library; company → import source |
| `src/scrape.ts`    | the browser check and the scraper run                                         |
| `src/map.ts`       | scraped transaction → `ImportLineInput` (shared contract)                     |
| `src/client.ts`    | `POST /api/v1/accounts/:id/imports`, chunked                                  |
| `src/commands/`    | `init`, `sync`, `accounts`, `doctor`                                          |

Design and rationale: `docs/phase-20-accounts-design.md` §3.5, §4.1, §6.2, §6.4; the research behind
the library choice: `docs/notes/bank-sync-research-2026-09.md` §2 and §5.
