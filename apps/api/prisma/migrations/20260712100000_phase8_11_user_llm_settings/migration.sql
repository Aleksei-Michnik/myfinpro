-- Phase 8.11 — per-user LLM selection + encrypted BYOK credentials
-- (docs/runbook-llm-extraction.md §9). Expand-only: nullable columns on
-- users and a new dedicated secrets table; no backfill needed — null
-- selection means "deployment default provider".

ALTER TABLE `users`
    ADD COLUMN `llm_provider` VARCHAR(20) NULL,
    ADD COLUMN `llm_model` VARCHAR(60) NULL;

-- Secrets are AES-256-GCM encrypted application-side (v1:<iv>:<tag>:<cipher>);
-- this table never sees plaintext.
CREATE TABLE `user_llm_credentials` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `credential_kind` VARCHAR(10) NOT NULL DEFAULT 'api_key',
    `encrypted_value` TEXT NOT NULL,
    `key_hint` VARCHAR(8) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_llm_credentials_user_id_provider_key`(`user_id`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_llm_credentials` ADD CONSTRAINT `user_llm_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
