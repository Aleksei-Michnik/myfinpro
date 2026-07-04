-- Phase 6, iteration 6.19 — add `cancelled_at` to `payment_plans` so plan
-- cancellation is an explicit, terminal, auditable state (mirrors the
-- `payment_schedules.cancelled_at` convention from 6.17.2). Nullable +
-- expand-only: existing rows are unaffected.

ALTER TABLE `payment_plans`
    ADD COLUMN `cancelled_at` DATETIME(3) NULL;
