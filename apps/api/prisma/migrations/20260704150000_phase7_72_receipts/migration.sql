-- Phase 7, iteration 7.2 — receipts, receipt_items, merchants (expand-only).
-- Receipt lifecycle + extraction storage per docs/phase-7-receipts-design.md §3.

-- CreateTable
CREATE TABLE `merchants` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `normalized_name` VARCHAR(200) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchants_normalized_name_key`(`normalized_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipts` (
    `id` VARCHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'UPLOADED',
    `source` VARCHAR(20) NOT NULL DEFAULT 'upload',
    `file_ref` VARCHAR(500) NULL,
    `original_name` VARCHAR(255) NULL,
    `mime_type` VARCHAR(100) NULL,
    `size_bytes` INTEGER NULL,
    `source_url` VARCHAR(2000) NULL,
    `merchant_id` VARCHAR(36) NULL,
    `extracted_merchant_name` VARCHAR(200) NULL,
    `purchased_at` DATETIME(3) NULL,
    `currency` VARCHAR(3) NULL,
    `total_cents` INTEGER NULL,
    `discount_cents` INTEGER NULL,
    `raw_extraction` JSON NULL,
    `failure_reason` VARCHAR(500) NULL,
    `uploaded_by_id` VARCHAR(36) NOT NULL,
    `payment_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `receipts_payment_id_key`(`payment_id`),
    INDEX `receipts_uploaded_by_id_status_idx`(`uploaded_by_id`, `status`),
    INDEX `receipts_merchant_id_idx`(`merchant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipt_items` (
    `id` VARCHAR(36) NOT NULL,
    `receipt_id` VARCHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `raw_name` VARCHAR(300) NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 1,
    `unit_price_cents` INTEGER NULL,
    `discount_cents` INTEGER NOT NULL DEFAULT 0,
    `total_cents` INTEGER NOT NULL,
    `category_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `receipt_items_category_id_idx`(`category_id`),
    UNIQUE INDEX `receipt_items_receipt_id_position_key`(`receipt_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_items` ADD CONSTRAINT `receipt_items_receipt_id_fkey` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_items` ADD CONSTRAINT `receipt_items_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

