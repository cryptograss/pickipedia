-- PickiPedia Invitations table
-- Stores invite codes for gated account creation

CREATE TABLE IF NOT EXISTS /*_*/pickipedia_invites (
    -- Primary key
    ppi_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,

    -- Random hex invite code (32 chars)
    ppi_code VARCHAR(32) NOT NULL,

    -- User ID of the person who created the invite
    ppi_inviter_id INT UNSIGNED NOT NULL,

    -- Intended username for the invitee (soft tracking, not enforced)
    ppi_invitee_name VARCHAR(255) NULL,

    -- Type of entity: 'human' or 'bot'
    ppi_entity_type ENUM('human', 'bot') NOT NULL DEFAULT 'human',

    -- Relationship type: how the inviter knows the invitee
    ppi_relationship_type VARCHAR(32) NOT NULL DEFAULT 'irl-buds',

    -- When the invite was created
    ppi_created_at BINARY(14) NOT NULL,

    -- When the invite expires (NULL = never expires)
    ppi_expires_at BINARY(14) NULL,

    -- When the invite was used (NULL = not yet used)
    ppi_used_at BINARY(14) NULL,

    -- User ID of the account that was created with this invite
    ppi_used_by_id INT UNSIGNED NULL
) /*$wgDBTableOptions*/;

-- Index on code for fast lookups during signup
CREATE UNIQUE INDEX /*i*/ppi_code ON /*_*/pickipedia_invites (ppi_code);

-- Index on inviter for listing user's invites
CREATE INDEX /*i*/ppi_inviter_id ON /*_*/pickipedia_invites (ppi_inviter_id);

-- Index on invitee name for checking existing invites
CREATE INDEX /*i*/ppi_invitee_name ON /*_*/pickipedia_invites (ppi_invitee_name);
