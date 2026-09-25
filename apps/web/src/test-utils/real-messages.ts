// Test helper — resolve translation keys against the real English bundle so
// a component that reads a key the bundle lacks fails visibly (the literal
// key path shows up in the rendered text, mirroring next-intl's fallback).
import enMessages from '@/../messages/en.json';

export function resolveMessage(namespace: string | undefined, key: string): string {
  const path = (namespace ? `${namespace}.${key}` : key).split('.');
  let cur: unknown = enMessages;
  for (const seg of path) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return namespace ? `${namespace}.${key}` : key;
    }
  }
  return typeof cur === 'string' ? cur : namespace ? `${namespace}.${key}` : key;
}

/** A `next-intl` mock backed by the real English messages. */
export function realMessagesIntl() {
  return {
    useLocale: () => 'en',
    useTranslations:
      (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
        const msg = resolveMessage(namespace, key);
        if (values && typeof values.count === 'number') return `${msg}:${values.count}`;
        return msg;
      },
  };
}
