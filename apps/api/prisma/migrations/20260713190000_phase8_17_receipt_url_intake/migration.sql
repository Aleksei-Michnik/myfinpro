-- Phase 8.17 — anonymized online-receipt URL intake log. No user link:
-- used only to spot frequent providers (adapter candidates) and to
-- rate-limit our egress per host. path_template stores the masked URL shape.

CREATE TABLE `receipt_url_intakes` (
    `id` VARCHAR(36) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `path_template` VARCHAR(500) NOT NULL,
    `provider` VARCHAR(50) NULL,
    `outcome` VARCHAR(40) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `receipt_url_intakes_host_created_at_idx`(`host`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
