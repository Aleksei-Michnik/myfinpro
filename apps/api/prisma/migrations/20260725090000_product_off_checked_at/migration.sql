-- AlterTable
ALTER TABLE `products` ADD COLUMN `off_checked_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `products_off_checked_at_idx` ON `products`(`off_checked_at`);
