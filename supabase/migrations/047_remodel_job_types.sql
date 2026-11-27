-- Migration 047: Job types for remodel tenant
-- Adds in-home consultation and installation job types used by RECAST California.

ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'remodel_consult';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'remodel_install';
