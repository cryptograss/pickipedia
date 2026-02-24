# PickiPediaInvitations

A MediaWiki extension that gates account creation behind invite codes, creating an accountability chain for all users.

## Why This Exists

PickiPedia was getting hit by bot spam. Rather than playing whack-a-mole with CAPTCHAs and blocklists, this extension requires that every new account be invited by an existing user. This creates:

1. **A barrier to spam** - bots can't self-register
2. **An accountability chain** - every user can be traced back to who invited them
3. **Entity attestations** - each user has a tamper-protected page declaring whether they're human or bot

## How It Works

### For Users

1. An existing user visits `Special:CreateInvite`
2. They enter the intended username and whether it's for a human or bot
3. They get an invite link like `https://pickipedia.xyz/wiki/Special:CreateAccount?invite=abc123...`
4. They send this link to the invitee
5. The invitee clicks the link, which pre-fills the invite code
6. The invitee registers with the **exact username** specified in the invite
7. On success, an `EntityAttestation` page is automatically created at `User:TheirName/EntityAttestation`

### For Admins

- `Special:ManageInvites` shows all invites (used, unused, expired)
- Can view invitation chains (who invited whom, going back to genesis)
- Can revoke unused invites

### Entity Attestations

Every user gets a protected subpage documenting:
- **Entity type**: human or bot
- **Invited by**: who created their invite
- **Invited at**: when they joined
- **Semantic properties**: `[[Entity type::human]]`, `[[Invited by::User:X]]`

These pages are protected so only sysops can edit them - the whole point is tamper-resistance.

## Installation

1. Clone/copy the extension to `extensions/PickiPediaInvitations/`

2. Add to `LocalSettings.php`:
   ```php
   wfLoadExtension( 'PickiPediaInvitations' );
   ```

3. Run database update:
   ```bash
   php maintenance/update.php
   ```

4. Create `Template:EntityAttestation` on the wiki (see below)

5. Bootstrap existing users:
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
| `ppi_invitee_name` | VARCHAR(255) | Intended username |
| `ppi_entity_type` | ENUM | 'human' or 'bot' |
| `ppi_created_at` | BINARY(14) | Creation timestamp |
| `ppi_expires_at` | BINARY(14) | Expiration (NULL = never) |
| `ppi_used_at` | BINARY(14) | When used (NULL = unused) |
| `ppi_used_by_id` | INT | User ID created with this invite |

## Template:EntityAttestation

Create this template on the wiki:

```wikitext
<noinclude>
Documents the entity type and invitation chain for a user account.
This template is automatically added to user subpages by the PickiPediaInvitations extension.

'''Do not edit EntityAttestation pages manually''' - they are protected for tamper-resistance.

[[Category:Templates]]
</noinclude><includeonly>{{#if:{{{genesis|}}}|
{| class="wikitable" style="float:right; margin-left:1em;"
|-
! colspan="2" | Entity Attestation
|-
| '''Type''' || {{{entity_type|human}}}
|-
| '''Status''' || Genesis User
|-
| '''Attested''' || {{{invited_at|unknown}}}
|}
[[Category:Genesis Users]]
|
{| class="wikitable" style="float:right; margin-left:1em;"
|-
! colspan="2" | Entity Attestation
|-
| '''Type''' || {{{entity_type|human}}}
|-
| '''Invited by''' || [[{{{invited_by|Unknown}}}]]
|-
| '''Invited''' || {{{invited_at|unknown}}}
|}
}}
</includeonly>
```

## Special Pages

- **Special:CreateInvite** - Create invite codes (any logged-in user)
- **Special:ManageInvites** - View/revoke invites, see chains (sysops only)

## Permissions

- **Sysops and bureaucrats** can create accounts without invite codes (for manual account creation)
- **Any logged-in user** can create invites
- **Only sysops** can edit EntityAttestation pages

## Files

```
PickiPediaInvitations/
├── extension.json                 # Extension manifest
├── README.md                      # This file
├── i18n/
│   └── en.json                    # English messages
├── maintenance/
│   └── bootstrapAttestations.php  # Bootstrap existing users
├── sql/
│   └── tables.sql                 # Database schema
└── src/
    ├── Hooks.php                  # Schema + LocalUserCreated hooks
    ├── InviteAuthProvider.php     # Pre-auth provider (gates signup)
    ├── InviteStore.php            # Database operations
    ├── SpecialCreateInvite.php    # Create invites UI
    └── SpecialManageInvites.php   # Admin management UI
```

## Querying the Accountability Chain

With Semantic MediaWiki, you can query invitation relationships:

```wikitext
{{#ask:
 [[Invited by::User:Justin]]
 |?Entity type
 |?Invited by
}}
```

This shows everyone Justin has invited.

## System User

The extension creates pages using a system user account called `Invitations-bot`. This account is created automatically and is used so that attestation pages aren't attributed to the new user or the inviter.

## Authors

- Magent
- Justin Holmes

## License

GPL-2.0-or-later
