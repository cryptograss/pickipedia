-- Add relationship_type column to pickipedia_invites
-- Run via update.php

ALTER TABLE /*_*/pickipedia_invites
    MODIFY COLUMN ppi_invitee_name VARCHAR(255) NULL,
    ADD COLUMN ppi_relationship_type VARCHAR(32) NOT NULL DEFAULT 'irl-buds' AFTER ppi_entity_type;
