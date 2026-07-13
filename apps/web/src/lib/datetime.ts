// Helpers for `<input type="datetime-local">`, whose only accepted value
// shape is `YYYY-MM-DDTHH:mm` (local zone, no seconds, no timezone).
// Shared by every dialog that edits a timestamp (payments, manual receipts).

/** Current local date+time as a `YYYY-MM-DDTHH:mm` datetime-local value. */
export function nowLocalIso(): string {
  const now = new Date();
  const off = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - off).toISOString().slice(0, 16);
}

/** ISO UTC timestamp → local-zone datetime-local value (falls back to now). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return nowLocalIso();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** Local-zone datetime-local value → ISO UTC timestamp (falls back to now). */
export function localInputToIso(local: string): string {
  // `new Date('YYYY-MM-DDTHH:mm')` interprets a bare value as local time,
  // so toISOString() yields the correct UTC counterpart.
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}
