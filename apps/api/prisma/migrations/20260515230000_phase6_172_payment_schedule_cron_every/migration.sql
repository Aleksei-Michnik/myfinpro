-- Phase 6, iteration 6.17.2 — refactor `payment_schedules` for the cron / everyMs
-- model that mirrors BullMQ's Queue.upsertJobScheduler API.
--
-- The 6.2 columns (`frequency` / `interval` / `next_occurrence_at` /
-- `max_occurrences` / `generated_count` / `is_active`) were never wired to a
-- real producer or consumer, so dropping them here is safe — no production
-- rows exist. The new shape lets the service write `cron` OR `every_ms`
-- (exclusive — service-level invariant) plus optional `limit` / `ends_at` /
-- `paused_at` / `cancelled_at` / scheduler-bookkeeping fields.

ALTER TABLE `payment_schedules`
    DROP INDEX `payment_schedules_is_active_next_occurrence_at_idx`;

ALTER TABLE `payment_schedules`
    DROP COLUMN `frequency`,
    DROP COLUMN `interval`,
    DROP COLUMN `next_occurrence_at`,
    DROP COLUMN `max_occurrences`,
    DROP COLUMN `generated_count`,
    DROP COLUMN `is_active`,
    ADD COLUMN `cron` VARCHAR(120) NULL,
    ADD COLUMN `every_ms` INTEGER NULL,
    ADD COLUMN `limit` INTEGER NULL,
    ADD COLUMN `next_run_at` DATETIME(3) NULL,
    ADD COLUMN `last_run_at` DATETIME(3) NULL,
    ADD COLUMN `paused_at` DATETIME(3) NULL,
    ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    MODIFY COLUMN `starts_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `payment_schedules_next_run_at_idx`
    ON `payment_schedules`(`next_run_at`);
