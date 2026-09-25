'use client';

// Phase 20 · 20.5 — manual column mapping for a statement whose format was
// not recognised (UI spec §1 step 2). One kit <Select> per target field; the
// options are the real header cells, so the user maps what they see.

import type { ManualColumnMapping, StatementField } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/Select';

/** The targets a user can map by hand — the rest the parser derives. */
export const MAPPABLE_FIELDS = [
  'date',
  'amount',
  'debit',
  'credit',
  'description',
  'balance',
  'reference',
] as const satisfies readonly StatementField[];
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

export interface StatementColumnMapperProps {
  /** The header row's cells, in column order. */
  headers: string[];
  value: ManualColumnMapping['columns'];
  onChange(next: ManualColumnMapping['columns']): void;
  disabled?: boolean;
}

/** Date plus either a signed amount or a debit/credit pair — what the parser needs. */
export function isMappingComplete(columns: ManualColumnMapping['columns']): boolean {
  const has = (f: MappableField) => typeof columns[f] === 'number';
  return has('date') && (has('amount') || has('debit') || has('credit'));
}

export function StatementColumnMapper({
  headers,
  value,
  onChange,
  disabled,
}: StatementColumnMapperProps) {
  const t = useTranslations('accounts.import');

  const set = (field: MappableField, raw: string) => {
    const next = { ...value };
    if (raw === '') delete next[field];
    else next[field] = Number(raw);
    onChange(next);
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="statement-import-mapper">
      {MAPPABLE_FIELDS.map((field) => (
        <Select
          key={field}
          label={t(`columns.${field}`)}
          value={typeof value[field] === 'number' ? String(value[field]) : ''}
          onChange={(e) => set(field, e.target.value)}
          disabled={disabled}
          size="sm"
          data-testid={`statement-import-map-${field}`}
        >
          <option value="">{t('columnNone')}</option>
          {headers.map((header, index) => (
            <option key={index} value={index}>
              {t('columnOption', { index: index + 1, header: header || '·' })}
            </option>
          ))}
        </Select>
      ))}
    </div>
  );
}
