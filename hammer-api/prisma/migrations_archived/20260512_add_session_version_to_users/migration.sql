-- AlterTable: Add sessionVersion to User for token invalidation
-- This field is incremented when password, roles, or activation status change.
-- Existing tokens carrying the old value are rejected by getCurrentSession().
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
