-- Multiple categories per transaction (expand-only). The PRIMARY category stays
-- on transactions.category_id; this table holds only the ADDITIONAL categories
-- in 1-based position order. No backfill needed — existing transactions simply
-- have zero additional categories.

-- CreateTable
CREATE TABLE `transaction_categories` (
    `id` VARCHAR(36) NOT NULL,
    `transaction_id` VARCHAR(36) NOT NULL,
    `category_id` VARCHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `transaction_categories_category_id_idx`(`category_id`),
    UNIQUE INDEX `transaction_categories_transaction_id_category_id_key`(`transaction_id`, `category_id`),
    UNIQUE INDEX `transaction_categories_transaction_id_position_key`(`transaction_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `transaction_categories` ADD CONSTRAINT `transaction_categories_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_categories` ADD CONSTRAINT `transaction_categories_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
