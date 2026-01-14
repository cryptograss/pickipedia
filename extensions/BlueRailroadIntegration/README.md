# Blue Railroad Integration

Imports Blue Railroad NFT token data from the arthel chain data JSON into Semantic MediaWiki.

## Setup

1. Enable the extension in `LocalSettings.php`:
   ```php
   wfLoadExtension('BlueRailroadIntegration');
   ```

2. Create the namespace (add to `LocalSettings.php`):
   ```php
   define('NS_BLUERAILROAD', 3000);
   define('NS_BLUERAILROAD_TALK', 3001);
   $wgExtraNamespaces[NS_BLUERAILROAD] = 'BlueRailroad';
   $wgExtraNamespaces[NS_BLUERAILROAD_TALK] = 'BlueRailroad_talk';
   ```

3. Create the wiki template `Template:Blue Railroad Token` with this content:
   ```wiki
   <noinclude>
   Template for displaying Blue Railroad NFT token data.
   </noinclude><includeonly>
   {| class="wikitable" style="float:right; margin-left:1em; width:300px;"
   |+ '''Blue Railroad Token #{{{token_id}}}'''
   |-
   ! Song ID
   | [[Has song id::{{{song_id}}}]]
   |-
   ! Date Minted
   | [[Has date minted::{{{date}}}]]
   |-
   ! Owner
   | [[Has owner::{{{owner_display}}}]] {{#ifeq:{{{owner_display}}}|{{{owner}}}||<br/><small>({{{owner}}})</small>}}
   |-
   ! Video
   | [https://gateway.pinata.cloud/ipfs/{{#replace:{{{uri}}}|ipfs://|}} View on IPFS]
   |-
   ! Contract
   | [https://optimistic.etherscan.io/token/0xCe09A2d0d0BDE635722D8EF31901b430E651dB52?a={{{token_id}}} View on Etherscan]
   |}
   [[Has token id::{{{token_id}}}]]
   [[Has video uri::{{{uri}}}]]
   [[Has owner address::{{{owner}}}]]
   </includeonly>
   ```

4. Create SMW properties (in wiki):
   - `Property:Has token id` - Type: Number
   - `Property:Has song id` - Type: Number
   - `Property:Has date minted` - Type: Date
   - `Property:Has owner` - Type: Text
   - `Property:Has owner address` - Type: Text
   - `Property:Has video uri` - Type: URL

## Running the Import

The import script reads from `chain-data/chainData.json` in the MediaWiki install directory.

```bash
# Dry run to see what would be imported
php extensions/BlueRailroadIntegration/maintenance/importBlueRailroads.php --dry-run

# Actually import
php extensions/BlueRailroadIntegration/maintenance/importBlueRailroads.php
```

## Deployment Architecture

The import script must run against the live MediaWiki database. Since PickiPedia runs
on NearlyFreeSpeech (NFS) and Jenkins builds on maybelle, there are two options:

### Option 1: SSH trigger from maybelle after deploy (recommended)
Add a post-deploy hook in `deploy-pickipedia-to-nfs.sh`:
```bash
# After rsync completes successfully
ssh nfs-pickipedia "cd ~/public && php extensions/BlueRailroadIntegration/maintenance/importBlueRailroads.php"
```

### Option 2: Cron job on NFS
Add a cron on NearlyFreeSpeech to run the import periodically:
```bash
*/10 * * * * cd ~/public && php extensions/BlueRailroadIntegration/maintenance/importBlueRailroads.php 2>&1 >> ~/logs/bluerailroad-import.log
```

### Option 3: Manual import
Run after deployment:
```bash
ssh nfs-pickipedia "cd ~/public && php extensions/BlueRailroadIntegration/maintenance/importBlueRailroads.php"
```

## Querying Tokens

Once imported, you can query tokens using SMW:

```wiki
{{#ask:
 [[Category:Blue Railroad Tokens]]
 |?Has token id
 |?Has song id
 |?Has date minted
 |?Has owner
 |format=table
}}
```

List tokens by owner:
```wiki
{{#ask:
 [[Category:Blue Railroad Tokens]]
 [[Has owner::justinholmes.eth]]
 |?Has token id
 |?Has song id
 |?Has date minted
}}
```
