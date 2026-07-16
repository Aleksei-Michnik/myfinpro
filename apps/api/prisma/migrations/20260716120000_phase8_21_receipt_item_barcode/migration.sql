-- Phase 8.21 — product codes extracted from receipt lines.
-- Normalized GTIN captured by extraction; nullable (most lines have none).
ALTER TABLE `receipt_items` ADD COLUMN `barcode` VARCHAR(14) NULL AFTER `raw_name`;
