-- Add notes column to pickipedia_invites
-- Run via update.php

ALTER TABLE /*_*/pickipedia_invites
    ADD COLUMN ppi_notes TEXT NULL;
