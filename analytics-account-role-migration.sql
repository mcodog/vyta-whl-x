-- Analytics account role
--
-- Adds a new `analytics` value to the `user_role` enum. Analytics accounts are a
-- view-heavy staff role: in the admin backend they can reach only the Analytics
-- dashboard and the Products catalog. On Products they may edit a product's
-- descriptive content (name, category, description, strength, images, COA, etc.)
-- but NOT its price/stock/pricing or visibility, and they cannot create or delete
-- products. All of that is enforced in the app + the products API; this migration
-- only makes the role value assignable.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside the same transaction that
-- later uses the value. Run this statement on its own first if your SQL client
-- wraps the whole file in a single transaction.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'analytics';
