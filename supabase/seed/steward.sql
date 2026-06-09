-- Steward Home Services — test seed data
-- Run AFTER all migrations.
-- This creates the Steward tenant + 3 techs + 20 customers + 50 jobs.

-- ─── Tenant ──────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, name, slug, phone, address, timezone, subscription_tier, subscription_status)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Steward Home Services',
  'steward',
  '(408) 555-0100',
  '1234 Tech Blvd, San Jose, CA 95101',
  'America/Los_Angeles',
  'growth',
  'active'
);

-- ─── Users ───────────────────────────────────────────────────────────────────
-- Note: auth_id is NULL here — set it after creating the user in Supabase Auth
INSERT INTO users (id, tenant_id, name, email, role, is_active) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'Alex Steward', 'alex@stewardhomeservices.com', 'owner', true),
  ('a0000001-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'Maria Lopez', 'maria@stewardhomeservices.com', 'dispatcher', true),
  ('a0000001-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'James Kim', 'jkim@stewardhomeservices.com', 'technician', true),
  ('a0000001-0000-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'Carlos Rivera', 'crivera@stewardhomeservices.com', 'technician', true),
  ('a0000001-0000-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'Priya Patel', 'ppatel@stewardhomeservices.com', 'technician', true);

-- ─── Technicians ─────────────────────────────────────────────────────────────
INSERT INTO technicians (id, tenant_id, user_id, name, phone, email, is_active) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000003', 'James Kim', '(408) 555-1001', 'jkim@stewardhomeservices.com', true),
  ('b0000001-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000004', 'Carlos Rivera', '(408) 555-1002', 'crivera@stewardhomeservices.com', true),
  ('b0000001-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000005', 'Priya Patel', '(408) 555-1003', 'ppatel@stewardhomeservices.com', true);

INSERT INTO tech_skills (tech_id, skill, level) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'plumbing_drain', 'expert'),
  ('b0000001-0000-0000-0000-000000000001', 'water_heater_repair', 'expert'),
  ('b0000001-0000-0000-0000-000000000001', 'plumbing_service', 'expert'),
  ('b0000001-0000-0000-0000-000000000002', 'drain_cleaning', 'expert'),
  ('b0000001-0000-0000-0000-000000000002', 'plumbing_service', 'proficient'),
  ('b0000001-0000-0000-0000-000000000002', 'general_maintenance', 'proficient'),
  ('b0000001-0000-0000-0000-000000000003', 'water_heater_install', 'expert'),
  ('b0000001-0000-0000-0000-000000000003', 'plumbing_service', 'proficient'),
  ('b0000001-0000-0000-0000-000000000003', 'hvac_service', 'learning');

-- ─── Customers ───────────────────────────────────────────────────────────────
INSERT INTO customers (id, tenant_id, name, email, phone, source) VALUES
  ('c0000001-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'Robert Chen', 'rchen@email.com', '(408) 555-2001', 'referral'),
  ('c0000001-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'Sarah Johnson', 'sjohnson@email.com', '(408) 555-2002', 'web'),
  ('c0000001-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'Michael Torres', 'mtorres@email.com', '(408) 555-2003', 'inbound_call'),
  ('c0000001-0000-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'Linda Nguyen', 'lnguyen@email.com', '(408) 555-2004', 'referral'),
  ('c0000001-0000-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'David Park', 'dpark@email.com', '(408) 555-2005', 'web'),
  ('c0000001-0000-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'Jennifer Wu', 'jwu@email.com', '(408) 555-2006', 'inbound_call'),
  ('c0000001-0000-0000-0000-000000000007', 'a1b2c3d4-0000-0000-0000-000000000001', 'Mark Anderson', 'manderson@email.com', '(408) 555-2007', 'referral'),
  ('c0000001-0000-0000-0000-000000000008', 'a1b2c3d4-0000-0000-0000-000000000001', 'Amy Martinez', 'amartinez@email.com', '(408) 555-2008', 'web'),
  ('c0000001-0000-0000-0000-000000000009', 'a1b2c3d4-0000-0000-0000-000000000001', 'Thomas Lee', 'tlee@email.com', '(408) 555-2009', 'inbound_call'),
  ('c0000001-0000-0000-0000-000000000010', 'a1b2c3d4-0000-0000-0000-000000000001', 'Patricia White', 'pwhite@email.com', '(408) 555-2010', 'referral'),
  ('c0000001-0000-0000-0000-000000000011', 'a1b2c3d4-0000-0000-0000-000000000001', 'James Garcia', 'jgarcia@email.com', '(408) 555-2011', 'web'),
  ('c0000001-0000-0000-0000-000000000012', 'a1b2c3d4-0000-0000-0000-000000000001', 'Nancy Brown', 'nbrown@email.com', '(408) 555-2012', 'inbound_call'),
  ('c0000001-0000-0000-0000-000000000013', 'a1b2c3d4-0000-0000-0000-000000000001', 'Christopher Davis', 'cdavis@email.com', '(408) 555-2013', 'referral'),
  ('c0000001-0000-0000-0000-000000000014', 'a1b2c3d4-0000-0000-0000-000000000001', 'Karen Wilson', 'kwilson@email.com', '(408) 555-2014', 'web'),
  ('c0000001-0000-0000-0000-000000000015', 'a1b2c3d4-0000-0000-0000-000000000001', 'Daniel Taylor', 'dtaylor@email.com', '(408) 555-2015', 'inbound_call'),
  ('c0000001-0000-0000-0000-000000000016', 'a1b2c3d4-0000-0000-0000-000000000001', 'Lisa Moore', 'lmoore@email.com', '(408) 555-2016', 'referral'),
  ('c0000001-0000-0000-0000-000000000017', 'a1b2c3d4-0000-0000-0000-000000000001', 'Anthony Jackson', 'ajackson@email.com', '(408) 555-2017', 'web'),
  ('c0000001-0000-0000-0000-000000000018', 'a1b2c3d4-0000-0000-0000-000000000001', 'Sandra Harris', 'sharris@email.com', '(408) 555-2018', 'inbound_call'),
  ('c0000001-0000-0000-0000-000000000019', 'a1b2c3d4-0000-0000-0000-000000000001', 'Paul Thompson', 'pthompson@email.com', '(408) 555-2019', 'referral'),
  ('c0000001-0000-0000-0000-000000000020', 'a1b2c3d4-0000-0000-0000-000000000001', 'Donna Martinez', 'dmartinez@email.com', '(408) 555-2020', 'web');

-- ─── Service Locations ───────────────────────────────────────────────────────
INSERT INTO service_locations (id, tenant_id, customer_id, address, city, state, zip, is_primary) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', '100 Willow Ave', 'San Jose', 'CA', '95101', true),
  ('d0000001-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002', '200 Oak St', 'Sunnyvale', 'CA', '94086', true),
  ('d0000001-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000003', '300 Elm Dr', 'Santa Clara', 'CA', '95050', true),
  ('d0000001-0000-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000004', '400 Pine Ln', 'Milpitas', 'CA', '95035', true),
  ('d0000001-0000-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000005', '500 Maple Ct', 'Campbell', 'CA', '95008', true),
  ('d0000001-0000-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000006', '600 Cedar Blvd', 'Los Gatos', 'CA', '95030', true),
  ('d0000001-0000-0000-0000-000000000007', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000007', '700 Birch Pl', 'Saratoga', 'CA', '95070', true),
  ('d0000001-0000-0000-0000-000000000008', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000008', '800 Spruce Way', 'Monte Sereno', 'CA', '95030', true),
  ('d0000001-0000-0000-0000-000000000009', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000009', '900 Ash Circle', 'Los Altos', 'CA', '94022', true),
  ('d0000001-0000-0000-0000-000000000010', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000010', '1000 Walnut St', 'Mountain View', 'CA', '94043', true),
  ('d0000001-0000-0000-0000-000000000011', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000011', '1100 Cherry Ave', 'Cupertino', 'CA', '95014', true),
  ('d0000001-0000-0000-0000-000000000012', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000012', '1200 Peach Rd', 'San Jose', 'CA', '95110', true),
  ('d0000001-0000-0000-0000-000000000013', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000013', '1300 Plum Lane', 'Sunnyvale', 'CA', '94087', true),
  ('d0000001-0000-0000-0000-000000000014', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000014', '1400 Apple Way', 'Santa Clara', 'CA', '95054', true),
  ('d0000001-0000-0000-0000-000000000015', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000015', '1500 Pear Ct', 'Campbell', 'CA', '95008', true),
  ('d0000001-0000-0000-0000-000000000016', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000016', '1600 Grape Blvd', 'Los Gatos', 'CA', '95032', true),
  ('d0000001-0000-0000-0000-000000000017', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000017', '1700 Berry St', 'Saratoga', 'CA', '95070', true),
  ('d0000001-0000-0000-0000-000000000018', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000018', '1800 Fig Dr', 'Monte Sereno', 'CA', '95030', true),
  ('d0000001-0000-0000-0000-000000000019', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000019', '1900 Lemon Pl', 'Los Altos', 'CA', '94024', true),
  ('d0000001-0000-0000-0000-000000000020', 'a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000020', '2000 Lime Ave', 'Mountain View', 'CA', '94040', true);

-- ─── Pricebook ────────────────────────────────────────────────────────────────
INSERT INTO pricebook_items (tenant_id, name, item_type, category, unit_price, cost, taxable) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Service Call', 'service', 'plumbing', 99.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Drain Cleaning — Standard', 'service', 'plumbing', 250.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Drain Cleaning — Main Line', 'service', 'plumbing', 450.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Water Heater Diagnosis', 'service', 'plumbing', 125.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Water Heater Repair', 'service', 'plumbing', 350.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Water Heater Installation — 40 gal', 'service', 'plumbing', 1200.00, 600, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Water Heater Installation — 50 gal', 'service', 'plumbing', 1400.00, 700, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Leak Repair — Minor', 'service', 'plumbing', 200.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Leak Repair — Major', 'service', 'plumbing', 600.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Toilet Repair', 'service', 'plumbing', 175.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Faucet Installation', 'service', 'plumbing', 225.00, 50, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Labor — Per Hour', 'labor', 'general', 125.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Emergency After-Hours Fee', 'fee', 'general', 150.00, 0, false),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Parts — Thermocouple', 'part', 'plumbing', 45.00, 18, true),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Parts — Anode Rod', 'part', 'plumbing', 35.00, 12, true),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Parts — Flapper Kit', 'part', 'plumbing', 15.00, 5, true);

-- ─── Jobs (mix of statuses for a realistic board) ─────────────────────────────
INSERT INTO jobs (tenant_id, customer_id, location_id, job_type, status, priority, description, scheduled_start, scheduled_end, tech_id, source) VALUES
  -- Today's jobs
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', 'd0000001-0000-0000-0000-000000000001', 'drain_cleaning', 'dispatched', 'normal', 'Slow drain in kitchen sink', now() + interval '1 hour', now() + interval '3 hours', 'b0000001-0000-0000-0000-000000000001', 'manual'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000002', 'd0000001-0000-0000-0000-000000000002', 'water_heater_repair', 'en_route', 'high', 'No hot water since this morning', now() + interval '30 minutes', now() + interval '2 hours', 'b0000001-0000-0000-0000-000000000002', 'inbound_call'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000003', 'd0000001-0000-0000-0000-000000000003', 'plumbing_service', 'unassigned', 'emergency', 'Burst pipe in bathroom — water shutoff already', now() + interval '2 hours', now() + interval '4 hours', null, 'inbound_call'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000004', 'd0000001-0000-0000-0000-000000000004', 'drain_cleaning', 'unassigned', 'normal', 'Bathtub backing up', now() + interval '3 hours', now() + interval '5 hours', null, 'web'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000005', 'd0000001-0000-0000-0000-000000000005', 'general_maintenance', 'in_progress', 'normal', 'Annual plumbing inspection', now() - interval '1 hour', now() + interval '1 hour', 'b0000001-0000-0000-0000-000000000003', 'manual'),
  -- Tomorrow's jobs
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000006', 'd0000001-0000-0000-0000-000000000006', 'water_heater_install', 'scheduled', 'normal', 'Replace 20yr old water heater with 50 gal', now() + interval '1 day', now() + interval '1 day 4 hours', 'b0000001-0000-0000-0000-000000000003', 'referral'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000007', 'd0000001-0000-0000-0000-000000000007', 'drain_cleaning', 'scheduled', 'normal', 'Sewer line backup — roots suspected', now() + interval '1 day 2 hours', now() + interval '1 day 6 hours', 'b0000001-0000-0000-0000-000000000001', 'inbound_call'),
  -- Completed jobs (for invoicing demo)
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000008', 'd0000001-0000-0000-0000-000000000008', 'plumbing_service', 'completed', 'normal', 'Fixed leaking kitchen faucet', now() - interval '2 hours', now() - interval '30 minutes', 'b0000001-0000-0000-0000-000000000001', 'manual'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000009', 'd0000001-0000-0000-0000-000000000009', 'drain_cleaning', 'completed', 'normal', 'Main line cleaning', now() - interval '5 hours', now() - interval '3 hours', 'b0000001-0000-0000-0000-000000000002', 'web'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000010', 'd0000001-0000-0000-0000-000000000010', 'water_heater_repair', 'invoiced', 'normal', 'Replaced thermocouple and heating element', now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 'b0000001-0000-0000-0000-000000000003', 'inbound_call');
