-- Phase 8.22 — multi-photo receipts: pages move to receipt_files.
-- Existing single files become page 1; the receipts columns are dropped
-- (no legacy readers remain after this deploy's code).

CREATE TABLE `receipt_files` (
    `id` VARCHAR(36) NOT NULL,
    `receipt_id` VARCHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `file_ref` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `receipt_files_receipt_id_position_key`(`receipt_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `receipt_files`
    ADD CONSTRAINT `receipt_files_receipt_id_fkey`
    FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `receipt_files` (`id`, `receipt_id`, `position`, `file_ref`, `mime_type`, `size_bytes`, `created_at`)
SELECT UUID(), `id`, 1, `file_ref`, COALESCE(`mime_type`, 'application/octet-stream'), COALESCE(`size_bytes`, 0), `created_at`
FROM `receipts`
WHERE `file_ref` IS NOT NULL;

ALTER TABLE `receipts`
    DROP COLUMN `file_ref`,
    DROP COLUMN `mime_type`,
    DROP COLUMN `size_bytes`;
