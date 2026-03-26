-- CreateTable
CREATE TABLE `oauth_providers` (
    `id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `provider_id` VARCHAR(255) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(255) NULL,
    `name` VARCHAR(255) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `oauth_providers_user_id_idx`(`user_id`),
    INDEX `oauth_providers_provider_email_idx`(`provider`, `email`),
    UNIQUE INDEX `oauth_providers_provider_provider_id_key`(`provider`, `provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `oauth_providers` ADD CONSTRAINT `oauth_providers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
