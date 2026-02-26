# PickiPediaInvitations

A MediaWiki extension that gates account creation behind invite codes, creating an accountability chain and web of trust for all users.

## Why This Exists

PickiPedia was getting hit by bot spam. Rather than playing whack-a-mole with CAPTCHAs and blocklists, this extension requires that every new account be invited by an existing user. This creates:

1. **A barrier to spam** - bots can't self-register
2. **An accountability chain** - every user can be traced back to who invited them
3. **A web of trust** - users can vouch for each other with attestations

## How It Works

### For New Users

1. Get an invite link from an existing member
2. Click the link (pre-fills the invite code on the signup form)
3. Choose your username and password
4. On signup, an `invite-record` page is automatically created at `User:YourName/Attestations/invite-record`

### For Existing Users

**Creating invites:**
1. Visit `Special:CreateInvite`
2. Select entity type (human or bot)
3. Get a shareable invite link
4. Send it to whoever you want to invite

**Vouching for others:**
1. Visit someone's user page
2. Click "Attest this user" in the sidebar
3. Choose attestation type and write your vouch
4. Creates a page at `User:TheirName/Attestations/by-YourName`

### For Everyone

`Special:ManageInvites` shows all invites in the system:
- View invitation chains (who invited whom, going back to genesis)
- Revoke unused invites (wiki philosophy: any user can revoke any unused invite)
- Filter by status (pending, used, expired)

## Attestation Structure

All attestation pages live under `User:X/Attestations/`:

| Page | Description | Created by |
|------|-------------|------------|
| `invite-record` | Foundational record from signup | System (automatic) |
| `by-{Attester}` | User vouching for this person | The attester |

### Invite Record

Every user gets a protected subpage documenting:
- **Entity type**: human or bot
- **Invited by**: who created their invite
- **Invited at**: when they joined
- **Semantic properties**: `[[Entity type::human]]`, `[[Invited by::User:X]]`

These pages are protected so only sysops can edit them.

### User Attestations

Users can create attestations vouching for each other:
- **Attestation types**: musician, collaborator, met-in-person, online-only, general vouch
- **Freeform text**: wikitext-enabled description
- **Edit protection**: only the attester (or sysops) can edit their attestation

## Installation

1. Clone/copy the extension to `extensions/PickiPediaInvitations/`

2. Add to `LocalSettings.php`:
   ```php
   wfLoadExtension( 'PickiPediaInvitations' );

   // Recommended: prevent anonymous edits
   $wgGroupPermissions['*']['edit'] = false;
   ```

3. Run database update:
   ```bash
   php maintenance/update.php
   ```

4. Create templates on the wiki:
   - `Template:InviteRecord` - for invite records (blue styling)
   - `Template:Attestation` - for user attestations (green styling)

5. Create signup welcome message:
   - Edit `MediaWiki:Signupstart` to explain the invite system

6. Bootstrap existing users:
   ```bash
   # Dry run first
   php extensions/PickiPediaInvitations/maintenance/bootstrapAttestations.php --dry-run

   # Then for real
   php extensions/PickiPediaInvitations/maintenance/bootstrapAttestations.php
   ```

## Configuration

In `LocalSettings.php`:

```php
// Require invite codes for signup (default: true)
$wgPickiPediaInvitesRequired = true;

// Default invite expiration in days (default: 30, 0 = never)
$wgPickiPediaInviteExpireDays = 30;
```

## Database Schema

Creates table `pickipedia_invites`:

| Column | Type | Description |
|--------|------|-------------|
| `ppi_id` | INT | Primary key |
| `ppi_code` | VARCHAR(32) | Random hex invite code |
| `ppi_inviter_id` | INT | User ID who created invite |
| `ppi_invitee_name` | VARCHAR(255) | (Legacy, unused) |
| `ppi_entity_type` | ENUM | 'human' or 'bot' |
| `ppi_created_at` | BINARY(14) | Creation timestamp |
| `ppi_expires_at` | BINARY(14) | Expiration (NULL = never) |
| `ppi_used_at` | BINARY(14) | When used (NULL = unused) |
| `ppi_used_by_id` | INT | User ID created with this invite |

## Special Pages

| Page | Access | Description |
|------|--------|-------------|
| `Special:CreateInvite` | Any logged-in user | Create invite codes |
| `Special:ManageInvites` | Any logged-in user | View/revoke invites, see chains |
| `Special:CreateAttestation` | Any logged-in user | Vouch for another user |

## UI Integration

- **Personal tools**: "Invite someone" link appears between Contributions and Log out
- **Sidebar on user pages**: "Attest this user" or "View your attestation" links
- **Signup page**: Welcome message from `MediaWiki:Signupstart`

## Querying the Web of Trust

With Semantic MediaWiki, you can query invitation and attestation relationships:

```wikitext
{{!-- Who did Justin invite? --}}
{{#ask:
 [[Invited by::User:Justin]]
 |?Entity type
}}

{{!-- All attestations for a user --}}
Special:PrefixIndex/User:SomeName/Attestations/
```

## Files

```
PickiPediaInvitations/
├── extension.json                 # Extension manifest
├── README.md                      # This file
├── PickiPediaInvitations.alias.php # Special page aliases
├── i18n/
│   └── en.json                    # English messages
├── maintenance/
│   └── bootstrapAttestations.php  # Bootstrap existing users
├── sql/
│   └── tables.sql                 # Database schema
└── src/
    ├── Hooks.php                  # Schema + attestation creation + UI hooks
    ├── InviteAuthProvider.php     # Pre-auth provider (gates signup)
    ├── InviteStore.php            # Database operations
    ├── SpecialCreateAttestation.php # Create attestation UI
    ├── SpecialCreateInvite.php    # Create invites UI
    └── SpecialManageInvites.php   # View/manage all invites
```

## System User

The extension creates pages using a system user account called `Invitations-bot`. This account is created automatically during `update.php` and is used so that invite-record pages aren't attributed to the new user or the inviter.

## Authors

- Magent
- Justin Holmes

## License

GPL-2.0-or-later
