-- Phase 8, iteration 8.1 — products, product_aliases, receipt_items product
-- linkage (expand-only). Two-layer product DB per docs/phase-8-products-design.md §2.

-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(36) NOT NULL,
    `barcode` VARCHAR(14) NULL,
    `name` VARCHAR(300) NOT NULL,
    `normalized_name` VARCHAR(300) NOT NULL,
    `brand` VARCHAR(200) NULL,
    `image_ref` VARCHAR(500) NULL,
    `default_category_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_barcode_key`(`barcode`),
    INDEX `products_normalized_name_idx`(`normalized_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_aliases` (
    `id` VARCHAR(36) NOT NULL,
    `product_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `normalized_name` VARCHAR(300) NOT NULL,
    `locale` VARCHAR(5) NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'confirmation',
    `confirmation_count` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `product_aliases_normalized_name_idx`(`normalized_name`),
    UNIQUE INDEX `product_aliases_product_id_normalized_name_key`(`product_id`, `normalized_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `receipt_items`
    ADD COLUMN `product_id` VARCHAR(36) NULL,
    ADD COLUMN `match_status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `match_candidates` JSON NULL,
    ADD COLUMN `purchased_at` DATETIME(3) NULL;

-- Backfill the denormalized purchase date for existing rows.
UPDATE `receipt_items` ri
JOIN `receipts` r ON r.`id` = ri.`receipt_id`
SET ri.`purchased_at` = COALESCE(r.`purchased_at`, r.`created_at`);

-- CreateIndex
CREATE INDEX `receipt_items_product_id_purchased_at_idx` ON `receipt_items`(`product_id`, `purchased_at`);

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_default_category_id_fkey` FOREIGN KEY (`default_category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_aliases` ADD CONSTRAINT `product_aliases_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_items` ADD CONSTRAINT `receipt_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
