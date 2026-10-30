-- Reels can be kept as drafts by their author before being sent for checking. Drafts are visible only to the author
-- (the existing read_scope policy: published, own, or platform administrator).
ALTER TYPE "ReelStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'PENDING';
