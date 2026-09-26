-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `account_id` VARCHAR(36) NULL,
    ADD COLUMN `transfer_account_id` VARCHAR(36) NULL;

-- CreateTable
CREATE TABLE `accounts` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `institution` VARCHAR(20) NULL,
    `currency` VARCHAR(3) NOT NULL,
    `last4` VARCHAR(4) NULL,
    `color` VARCHAR(16) NULL,
    `scope_type` VARCHAR(10) NOT NULL,
    `owner_id` VARCHAR(36) NULL,
    `group_id` VARCHAR(36) NULL,
    `opening_balance_cents` INTEGER NOT NULL DEFAULT 0,
    `opening_balance_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reported_balance_cents` INTEGER NULL,
    `reported_balance_at` DATETIME(3) NULL,
    `billing_account_id` VARCHAR(36) NULL,
    `billing_day` INTEGER NULL,
    `archived_at` DATETIME(3) NULL,
    `created_by_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `accounts_owner_id_scope_type_archived_at_idx`(`owner_id`, `scope_type`, `archived_at`),
    INDEX `accounts_group_id_scope_type_archived_at_idx`(`group_id`, `scope_type`, `archived_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_imports` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `imported_by_id` VARCHAR(36) NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `original_name` VARCHAR(255) NULL,
    `period_from` DATETIME(3) NULL,
    `period_to` DATETIME(3) NULL,
    `statement_balance_cents` INTEGER NULL,
    `statement_balance_at` DATETIME(3) NULL,
    `total_count` INTEGER NOT NULL DEFAULT 0,
    `inserted_count` INTEGER NOT NULL DEFAULT 0,
    `duplicate_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_imports_account_id_created_at_idx`(`account_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_statement_lines` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `import_id` VARCHAR(36) NOT NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `posted_at` DATETIME(3) NOT NULL,
    `value_at` DATETIME(3) NULL,
    `direction` VARCHAR(3) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `normalized_description` VARCHAR(300) NOT NULL,
    `memo` VARCHAR(300) NULL,
    `external_id` VARCHAR(64) NULL,
    `balance_after_cents` INTEGER NULL,
    `original_amount_cents` INTEGER NULL,
    `original_currency` VARCHAR(3) NULL,
    `installment_number` INTEGER NULL,
    `installment_total` INTEGER NULL,
    `category_hint` VARCHAR(100) NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `transaction_id` VARCHAR(36) NULL,
    `suggestion` JSON NULL,
    `decided_at` DATETIME(3) NULL,
    `decided_by_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `account_statement_lines_transaction_id_key`(`transaction_id`),
    INDEX `account_statement_lines_account_id_status_posted_at_idx`(`account_id`, `status`, `posted_at`),
    INDEX `account_statement_lines_account_id_normalized_description_idx`(`account_id`, `normalized_description`),
    UNIQUE INDEX `account_statement_lines_account_id_fingerprint_key`(`account_id`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `transactions_account_id_occurred_at_idx` ON `transactions`(`account_id`, `occurred_at`);

-- CreateIndex
CREATE INDEX `transactions_transfer_account_id_occurred_at_idx` ON `transactions`(`transfer_account_id`, `occurred_at`);

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_transfer_account_id_fkey` FOREIGN KEY (`transfer_account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_billing_account_id_fkey` FOREIGN KEY (`billing_account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_imports` ADD CONSTRAINT `account_imports_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_statement_lines` ADD CONSTRAINT `account_statement_lines_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_statement_lines` ADD CONSTRAINT `account_statement_lines_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `account_imports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_statement_lines` ADD CONSTRAINT `account_statement_lines_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
