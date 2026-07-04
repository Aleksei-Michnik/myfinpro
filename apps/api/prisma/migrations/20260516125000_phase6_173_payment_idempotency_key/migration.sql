-- Phase 6, iteration 6.17.3 — add `idempotency_key` to `payments` so the
-- occurrence-creation worker can use a deterministic
-- `${scheduleId}:${firedAtMs}` key as a unique-index guard against
-- double-creation when BullMQ re-fires a job. Nullable so existing manual
-- rows + ONE_TIME payments are unaffected.

ALTER TABLE `payments`
    ADD COLUMN `idempotency_key` VARCHAR(120) NULL;

CREATE UNIQUE INDEX `payments_idempotency_key_key`
    ON `payments`(`idempotency_key`);
