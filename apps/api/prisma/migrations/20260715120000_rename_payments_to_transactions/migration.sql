-- Phase 8.20 — rename the Payment entity to Transaction end-to-end.
-- "Payment" was the wrong umbrella term: the entity also models incomes and
-- (future) user-to-user transfers. Pure renames — tables, columns, indexes,
-- FK constraint names — no data is touched. MySQL cannot rename a constraint,
-- so FKs are dropped first and re-added under their new Prisma-conventional
-- names with the SAME referential actions.

-- 1) Drop foreign keys on the renamed tables + the two referrers.
ALTER TABLE `budget_alert_events` DROP FOREIGN KEY `budget_alert_events_payment_id_fkey`;
ALTER TABLE `receipts` DROP FOREIGN KEY `receipts_payment_id_fkey`;
ALTER TABLE `payment_attributions`
  DROP FOREIGN KEY `payment_attributions_group_id_fkey`,
  DROP FOREIGN KEY `payment_attributions_payment_id_fkey`,
  DROP FOREIGN KEY `payment_attributions_user_id_fkey`;
ALTER TABLE `payment_comments`
  DROP FOREIGN KEY `payment_comments_payment_id_fkey`,
  DROP FOREIGN KEY `payment_comments_user_id_fkey`;
ALTER TABLE `payment_documents`
  DROP FOREIGN KEY `payment_documents_payment_id_fkey`,
  DROP FOREIGN KEY `payment_documents_uploaded_by_id_fkey`;
ALTER TABLE `payment_plans` DROP FOREIGN KEY `payment_plans_payment_id_fkey`;
ALTER TABLE `payment_schedules` DROP FOREIGN KEY `payment_schedules_payment_id_fkey`;
ALTER TABLE `payment_stars`
  DROP FOREIGN KEY `payment_stars_payment_id_fkey`,
  DROP FOREIGN KEY `payment_stars_user_id_fkey`;
ALTER TABLE `payments`
  DROP FOREIGN KEY `payments_category_id_fkey`,
  DROP FOREIGN KEY `payments_created_by_id_fkey`,
  DROP FOREIGN KEY `payments_parent_payment_id_fkey`;

-- 2) Rename tables.
RENAME TABLE
  `payments` TO `transactions`,
  `payment_attributions` TO `transaction_attributions`,
  `payment_schedules` TO `transaction_schedules`,
  `payment_plans` TO `transaction_plans`,
  `payment_documents` TO `transaction_documents`,
  `payment_comments` TO `transaction_comments`,
  `payment_stars` TO `transaction_stars`;

-- 3) Rename columns.
ALTER TABLE `transactions` RENAME COLUMN `parent_payment_id` TO `parent_transaction_id`;
ALTER TABLE `transaction_plans` RENAME COLUMN `payments_count` TO `transactions_count`;
ALTER TABLE `transaction_attributions` RENAME COLUMN `payment_id` TO `transaction_id`;
ALTER TABLE `transaction_schedules` RENAME COLUMN `payment_id` TO `transaction_id`;
ALTER TABLE `transaction_plans` RENAME COLUMN `payment_id` TO `transaction_id`;
ALTER TABLE `transaction_documents` RENAME COLUMN `payment_id` TO `transaction_id`;
ALTER TABLE `transaction_comments` RENAME COLUMN `payment_id` TO `transaction_id`;
ALTER TABLE `transaction_stars` RENAME COLUMN `payment_id` TO `transaction_id`;
ALTER TABLE `receipts` RENAME COLUMN `payment_id` TO `transaction_id`;
ALTER TABLE `budget_alert_events` RENAME COLUMN `payment_id` TO `transaction_id`;

-- 4) Rename indexes to the new Prisma-conventional names. The two uniques
--    whose default names would exceed MySQL's 64-char identifier limit get
--    short names, pinned via `map:` in schema.prisma.
ALTER TABLE `transactions` RENAME INDEX `payments_category_id_idx` TO `transactions_category_id_idx`;
ALTER TABLE `transactions` RENAME INDEX `payments_created_by_id_occurred_at_idx` TO `transactions_created_by_id_occurred_at_idx`;
ALTER TABLE `transactions` RENAME INDEX `payments_direction_occurred_at_idx` TO `transactions_direction_occurred_at_idx`;
ALTER TABLE `transactions` RENAME INDEX `payments_idempotency_key_key` TO `transactions_idempotency_key_key`;
ALTER TABLE `transactions` RENAME INDEX `payments_parent_payment_id_idx` TO `transactions_parent_transaction_id_idx`;
ALTER TABLE `transactions` RENAME INDEX `payments_type_status_idx` TO `transactions_type_status_idx`;
ALTER TABLE `transaction_attributions` RENAME INDEX `payment_attributions_payment_id_idx` TO `transaction_attributions_transaction_id_idx`;
ALTER TABLE `transaction_attributions` RENAME INDEX `payment_attributions_group_id_scope_type_idx` TO `transaction_attributions_group_id_scope_type_idx`;
ALTER TABLE `transaction_attributions` RENAME INDEX `payment_attributions_user_id_scope_type_idx` TO `transaction_attributions_user_id_scope_type_idx`;
ALTER TABLE `transaction_attributions` RENAME INDEX `payment_attributions_payment_id_scope_type_user_id_group_id_key` TO `transaction_attributions_scope_key`;
ALTER TABLE `transaction_schedules` RENAME INDEX `payment_schedules_payment_id_key` TO `transaction_schedules_transaction_id_key`;
ALTER TABLE `transaction_schedules` RENAME INDEX `payment_schedules_next_run_at_idx` TO `transaction_schedules_next_run_at_idx`;
ALTER TABLE `transaction_plans` RENAME INDEX `payment_plans_payment_id_key` TO `transaction_plans_transaction_id_key`;
ALTER TABLE `transaction_documents` RENAME INDEX `payment_documents_payment_id_idx` TO `transaction_documents_transaction_id_idx`;
ALTER TABLE `transaction_documents` RENAME INDEX `payment_documents_uploaded_by_id_fkey` TO `transaction_documents_uploaded_by_id_fkey`;
ALTER TABLE `transaction_comments` RENAME INDEX `payment_comments_payment_id_created_at_idx` TO `transaction_comments_transaction_id_created_at_idx`;
ALTER TABLE `transaction_comments` RENAME INDEX `payment_comments_user_id_idx` TO `transaction_comments_user_id_idx`;
ALTER TABLE `transaction_stars` RENAME INDEX `payment_stars_payment_id_user_id_key` TO `transaction_stars_transaction_id_user_id_key`;
ALTER TABLE `transaction_stars` RENAME INDEX `payment_stars_user_id_created_at_idx` TO `transaction_stars_user_id_created_at_idx`;
ALTER TABLE `receipts` RENAME INDEX `receipts_payment_id_key` TO `receipts_transaction_id_key`;
ALTER TABLE `budget_alert_events` RENAME INDEX `budget_alert_events_payment_id_fkey` TO `budget_alert_events_transaction_id_fkey`;
ALTER TABLE `budget_alert_events` RENAME INDEX `budget_alert_events_kind_budget_id_payment_id_period_key_key` TO `budget_alert_events_alert_dedup_key`;

-- 5) Re-add the foreign keys under their new names (same referential actions).
ALTER TABLE `transactions`
  ADD CONSTRAINT `transactions_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `transactions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `transactions_parent_transaction_id_fkey` FOREIGN KEY (`parent_transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `transaction_attributions`
  ADD CONSTRAINT `transaction_attributions_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `transaction_attributions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `transaction_attributions_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `transaction_schedules`
  ADD CONSTRAINT `transaction_schedules_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `transaction_plans`
  ADD CONSTRAINT `transaction_plans_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `transaction_documents`
  ADD CONSTRAINT `transaction_documents_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `transaction_documents_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `transaction_comments`
  ADD CONSTRAINT `transaction_comments_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `transaction_comments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `transaction_stars`
  ADD CONSTRAINT `transaction_stars_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `transaction_stars_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `receipts`
  ADD CONSTRAINT `receipts_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `budget_alert_events`
  ADD CONSTRAINT `budget_alert_events_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
