# Bank sync research — Israel, September 2026

Checked 2026-09-25 for [`phase-20-accounts-design.md`](../phase-20-accounts-design.md) §3. Every
claim carries its source; **unverified** marks what no primary source confirmed. No real statement
was used — column names come from public parsers written against real exports.

## 1. Open Banking (Israel)

- The Financial Information Services Law (2021) makes the Israel Securities Authority the regulator
  and **requires a licence** for a financial-information (account-information) service provider;
  already-regulated financial institutions are exempt but need their regulator's authorisation.
  Fintech _companies_ obtain licences; no path for an individual or a personal app is described.
  Sources: [Times of Israel](https://www.timesofisrael.com/spotlight/israels-open-banking-reform-kicks-off-in-june/),
  [Gornitzky](https://www.gornitzky.com/the-open-banking-reform/),
  [Bank of Israel implementation guidelines (PDF)](https://boi.org.il/media/fhwbfq1k/111529.pdf).
- Banks must publish a developer portal and a sandbox for third-party providers
  ([Poalim dev portal](https://poalimdev.co.il/)); sandbox access for an unlicensed individual is
  **unverified** and, given the licence requirement for live data, not a channel for this app.
- Payment companies join the standard on 2026-06-06
  ([Herzog](https://herzoglaw.co.il/en/news-and-insights/draft-directive-for-payment-companies-regarding-the-implementation-of-an-open-banking-standard-published-for-public-comments/)).
- Salt Edge / Plaid / TrueLayer coverage of Israel: **unverified** (not checked).

## 2. `israeli-bank-scrapers` and the tools on it

- [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) (MIT): Puppeteer
  scrapers for Hapoalim, Leumi, Discount, Mercantile, Mizrahi, Otsar Hahayal, Union, Beinleumi,
  Massad, Yahav, Beyahad Bishvilha, OneZero (experimental), Behatsdaa, Visa Cal, Max, Isracard,
  Amex. Credentials per institution: Hapoalim `userCode`+`password`; Leumi / Mizrahi / Cal / Max /
  Otsar / Beinleumi / Massad `username`+`password`; Discount / Mercantile `id`+`password`+`num`;
  Isracard / Amex `id`+`card6Digits`+`password`; Yahav `username`+`password`+`nationalID`. Some
  institutions need OTP (async callback or a long-term token). Transaction shape: `type`,
  `identifier`, `date`, `processedDate`, `originalAmount`, `originalCurrency`, `chargedAmount`,
  `description`, `memo`, `installments`, `status`. Published to npm on every merge to master;
  breaks when a bank changes its site (by nature — no version pinned here). No ToS discussion in
  the README; users act with their own credentials.
- [daniel-hauser/moneyman](https://github.com/daniel-hauser/moneyman): runs the scrapers in the
  user's **own GitHub Actions** (credentials as Actions secrets) or locally in Docker; forwards to
  Sheets, YNAB, Actual Budget, Buxfer, Postgres, a web POST, JSON…; logs to files by default to
  keep secrets off stdout; README warns that keeping all passwords in one place is risky.
- [brafdlog/caspion](https://github.com/brafdlog/caspion): Electron desktop app, credentials in the
  OS keychain (`keytar`), exports to Sheets / YNAB / CSV / JSON; recommends read-only bank users.
- Pattern to reuse: **the scraper runs where the user controls the secrets; the finance app only
  receives rows.** That is design §3.5 channel B: `apps/connector` = the same idea with our import
  contract as the destination.

## 3. Manual exports — what the files look like

Sources: public parsers written against real exports —
[itayoliv/expense-tracker](https://github.com/itayoliv/expense-tracker) (Hapoalim, Isracard,
Discount), [nomaed/leumi-xls-parser](https://github.com/nomaed/leumi-xls-parser) (Leumi),
[navesarussi/MySelf PR #48](https://github.com/navesarussi/MySelf/pull/48) (Cal, Max, Leumi), and
[the hasolidit forum](https://www.hasolidit.com/kehila/threads/%D7%9E%D7%A2%D7%A7%D7%91-%D7%90%D7%97%D7%A8-%D7%97%D7%99%D7%95%D7%91%D7%99-%D7%9B%D7%A8%D7%98%D7%99%D7%A1%D7%99-%D7%90%D7%A9%D7%A8%D7%90%D7%99.221/)
(Cal offers Excel; a bank-issued Visa offered only PDF). No Israeli institution exports OFX, QIF,
CAMT or MT940 (**unverified** negative — none of the sources mention one).

| Institution    | File                                                | Header row                                    | Columns seen (Hebrew, verbatim)                                                                                                                                    | Amount convention                                                  | Dates                                     | Notes                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hapoalim       | `.xlsx` / `.csv`                                    | after a few title rows (scan ≤ 30)            | `תאריך`, `הפעולה`, `פרטים`, `אסמכתא`, `חובה`, `זכות`, `תאריך ערך`, (`לטובת`, `עבור`); a running balance column is **unverified** (alias `יתרה` soft-matched)       | debit / credit pair                                                | `dd/mm/yyyy`, `dd.mm.yyyy`, Excel serials | `אסמכתא` = reference; `הפעולה` is the action, `פרטים` the counter-party detail                                                                                                                          |
| Leumi          | `.xls` that is an **HTML table** (`תנועות בחשבון`)  | first row containing `תאריך` and `בחובה`      | `תאריך`, `תאריך ערך`, `תיאור`, `אסמכתא`, `בחובה`, `בזכות`, `היתרה`/`יתרה`                                                                                          | debit / credit pair; balance per row                               | `dd/mm/yy(yy)`                            | The decoder must accept an HTML document under an `.xls` name                                                                                                                                           |
| Discount       | `.xlsx`                                             | scan                                          | `תאריך`, `תיאור התנועה`, `יום ערך`, `זכות/חובה` (signed), `ערוץ ביצוע`; card: `כרטיס`, `בית עסק`, `תאריך עסקה`, `סכום העסקה`, `תאריך החיוב`, `סכום החיוב`, `פירוט` | signed single column (bank); charged vs original (card)            | as above                                  | Title carries `חשבון: <number>` — never stored                                                                                                                                                          |
| Isracard       | `.xlsx` / `.csv`, several tables on one sheet       | one header row per table; totals rows `סה"כ`  | `תאריך רכישה`, `שם בית עסק`, `סכום עסקה`, `מטבע עסקה`, `סכום חיוב`, `מטבע חיוב`, `מס' שובר`, `פירוט נוסף`, `חיוב בחשבון הבנק`                                      | `סכום חיוב` moves money; `סכום עסקה` + `מטבע עסקה` = original pair | `dd/mm/yyyy` or serials                   | Title rows give the billing month (`ספטמבר 2026`, `לחיוב ב-10.09`) and the card's last 4 (`… - 0423`); sections `עסקאות שטרם נקלטו` (pending), `עסקאות למועד חיוב`; installments appear in `פירוט נוסף` |
| Visa Cal       | `.xlsx` (`פירוט עסקאות וזיכויים`), PDF also offered | after the title row; headers may contain `\n` | `תאריך עסקה`, `שם בית עסק`, `סכום עסקה`, `סכום בש"ח` / `סכום חיוב`, `סוג עסקה`, `הערות`, `מועד חיוב`, (`סכום בדולר`)                                               | charged in ILS; original amount + currency when foreign            | Excel serials or `dd/mm/yyyy`             | `סוג עסקה` says `תשלומים` for installment rows, `הערות` carries "תשלום 2 מתוך 6" — **unverified** wording                                                                                               |
| Max            | `.xlsx` (`transaction-details_export_*`)            | after preamble rows (`כל המשתמשים`)           | `תאריך עסקה`, `שם בית העסק`, `קטגוריה`, `סכום חיוב`, `סכום עסקה מקורי`, `מטבע חיוב`, `מטבע עסקה`, `תאריך חיוב`, `אופן ביצוע`, `הערות`                              | `סכום חיוב` in `מטבע חיוב`; original pair                          | `dd-mm-yyyy`                              | `קטגוריה` is the issuer's own sector → `categoryHint`                                                                                                                                                   |
| CSV in general | —                                                   | —                                             | —                                                                                                                                                                  | —                                                                  | —                                         | Encodings seen: UTF-8 with BOM, UTF-8, `windows-1255`, `iso-8859-8`; try in that order                                                                                                                  |

Consequences for the parser (design §4.1): one engine over `string[][]` with **preset data**
(header aliases, amount convention, date formats, title-row extractors for billing date / last4,
skip rules for totals and section titles) and a manual column picker when detection fails.
Fixtures for tests are synthetic rows built from the header lists above, never real files.

## 4. Reconciliation heuristics in the field

- [Actual Budget](https://actualbudget.org/docs/transactions/importing/) and
  [James Long's write-up](https://medium.com/actualbudget/how-transaction-reconciliation-works-8dc5749bbd21):
  an `imported_id` is never imported twice; otherwise same amount + date within ~5–7 days + fuzzy
  payee ⇒ the imported row is merged into the manual one, which keeps its category.
- [Firefly III data importer](https://docs.firefly-iii.org/references/data-importer/duplicate-detection/):
  external-identifier dedup when the file has one, otherwise a hash over the transaction fields;
  deleted transactions still count as duplicates so "informative" rows never come back.
- YNAB (documented widely, **unverified** here): exact amount, ±10-day window, learned payee →
  category rules.
- Ledger / Beancount importers: deterministic ids hashed from institution + date + amount +
  narration; pending rows re-matched when they post.

Design §5 adopts: exact amount as the hard gate, a 5-day window, trigram description similarity
(already in the codebase), a per-account fingerprint for dedup, and "the lines table is the payee
memory".

## 5. Credit cards in Israel

Purchases accrue over a billing cycle and the bank debits one aggregate line on the billing day
(Isracard prints it as `לחיוב ב-<day>.<month>`; every issuer offers spreading a bill into
installments — [Isracard](https://marketing.isracard.co.il/pages/debtinstallments/)). Installment
purchases (`תשלומים`) appear as one line per monthly charge with an "n of N" marker; the scrapers
expose `installments: { number, total }` and `chargedAmount` vs `originalAmount`. Apps that avoid
double counting model the bank's line as a **transfer** to the card account — design §2.4.

## 6. Decoding library for the browser (design §4.1)

SheetJS reads `.xlsx`, legacy BIFF `.xls` **and HTML tables saved as `.xls`** (Leumi) from one
API, in the browser. The npm package `xlsx` is frozen at 0.18.5 with two published CVEs
(prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363) that are fixed only in the versions
SheetJS distributes from its own CDN (≥ 0.19.3 / ≥ 0.20.2). Decision: depend on the SheetJS CDN
tarball pinned by URL in `apps/web/package.json` (0.20.3 or newer; the lockfile records the URL
and its integrity), web-only, parsing on the user's own machine, input capped at 5 MB, `dense`
sheets, no formulas evaluated. `exceljs` cannot read `.xls`/HTML and was rejected for that reason.
