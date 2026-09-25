-- Widen categories.direction so it can hold 'BOTH' (4 chars).
--
-- 'BOTH' has been a legal CategoryDirection since Phase 6, but no seeded or
-- user-created category ever used it, so the too-narrow column went unnoticed
-- until the Phase 20 `transfer` system category (design §4.2). Widening a
-- VARCHAR keeps the 1-byte length prefix, so this is an in-place, expand-only
-- change: the currently running code writes at most 3 characters.
ALTER TABLE `categories` MODIFY `direction` VARCHAR(4) NOT NULL;
