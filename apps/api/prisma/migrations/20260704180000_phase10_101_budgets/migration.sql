-- Phase 10, iteration 10.1 — budgets, budget_alert_events, users.due_reminder_days (expand-only).
-- Budget definitions + alert dedup/history per docs/phase-10-budgets-design.md §3.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `due_reminder_days` INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE `budgets` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `scope_type` VARCHAR(10) NOT NULL,
    `owner_id` VARCHAR(36) NULL,
    `group_id` VARCHAR(36) NULL,
    `category_id` VARCHAR(36) NULL,
    `period` VARCHAR(10) NOT NULL,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `alert_threshold_pct` INTEGER NULL,
    `alert_overspend` BOOLEAN NOT NULL DEFAULT true,
    `archived_at` DATETIME(3) NULL,
    `created_by_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `budgets_owner_id_scope_type_archived_at_idx`(`owner_id`, `scope_type`, `archived_at`),
    INDEX `budgets_group_id_scope_type_archived_at_idx`(`group_id`, `scope_type`, `archived_at`),
    INDEX `budgets_category_id_idx`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_alert_events` (
    `id` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `budget_id` VARCHAR(36) NULL,
    `payment_id` VARCHAR(36) NULL,
    `period_key` VARCHAR(10) NOT NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `budget_alert_events_budget_id_created_at_idx`(`budget_id`, `created_at`),
    UNIQUE INDEX `budget_alert_events_kind_budget_id_payment_id_period_key_key`(`kind`, `budget_id`, `payment_id`, `period_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `budgets` ADD CONSTRAINT `budgets_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budgets` ADD CONSTRAINT `budgets_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budgets` ADD CONSTRAINT `budgets_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_alert_events` ADD CONSTRAINT `budget_alert_events_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_alert_events` ADD CONSTRAINT `budget_alert_events_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
