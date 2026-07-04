-- Phase 6 · Iteration 6.16.5 — Staging UX hotfix.
--
-- The seeded system category for incoming gifts (slug = `gift_in`) was
-- previously displayed as the singular "Gift", which read as a duplicate of
-- the OUT-direction "Gifts" in unfiltered category dropdowns. Rename the
-- display label to "Gifts received" so the two are visually distinct.
--
-- This is a name-only update — slug and id are preserved, so there is no
-- impact on payments referencing this category (payments.category_id).
-- Idempotent: only flips rows that still carry the legacy "Gift" label.

UPDATE `categories`
SET `name` = 'Gifts received',
    `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `slug` = 'gift_in'
  AND `direction` = 'IN'
  AND `owner_type` = 'system'
  AND `name` = 'Gift';
