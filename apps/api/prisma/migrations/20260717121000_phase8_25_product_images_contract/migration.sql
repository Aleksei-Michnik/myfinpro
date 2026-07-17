-- Phase 8, iteration 8.25 — contract step (design §3.1). Every read/write
-- moved to `product_images` in the cutover commit; the backfilled column
-- would otherwise rot as a stale duplicate of the position-1 rows.
ALTER TABLE `products` DROP COLUMN `image_ref`;
