-- Pricebook v2: add trade hierarchy, service-specific, and materials-specific fields.
-- The existing `category` column becomes the subcategory (e.g. "Drain Services").
-- New `trade` column holds the top-level trade (plumbing | hvac | electrical | general).

ALTER TABLE pricebook_items
  ADD COLUMN IF NOT EXISTS trade TEXT,
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS unit_of_measure TEXT DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS vendor TEXT;

-- Back-fill trade from the old flat category values so existing rows aren't orphaned.
UPDATE pricebook_items SET trade = 'plumbing'   WHERE category IN ('plumbing', 'water_heater') AND trade IS NULL;
UPDATE pricebook_items SET trade = 'hvac'        WHERE category = 'hvac'        AND trade IS NULL;
UPDATE pricebook_items SET trade = 'electrical'  WHERE category = 'electrical'   AND trade IS NULL;
UPDATE pricebook_items SET trade = 'general'     WHERE trade IS NULL;

-- Clear old flat category strings that are now redundant (we keep the column for any
-- rows that already had descriptive subcategories).
UPDATE pricebook_items
  SET category = NULL
  WHERE category IN ('plumbing', 'hvac', 'electrical', 'water_heater', 'general');
