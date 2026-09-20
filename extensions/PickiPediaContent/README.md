# PickiPediaContent

A home in the repository for the code and styling that render articles.

## Why

Two kinds of program code were living only on wiki pages:

- `MediaWiki:Common.css`, loaded for every reader on every page.
- `Module:*`, several hundred lines of Lua deciding what articles say.

Neither was reviewed, neither had history anyone could read, and neither could
be reverted with anything better than a hand-edit. The usual fix — grant a bot
account write access to those pages — makes it worse:

- Site CSS runs for every visitor on the real domain with the real
  certificate. It can exfiltrate through selector-triggered requests, overlay
  a convincing fake login, and place invisible targets over destructive
  actions. MediaWiki models this as its own privilege (`interface-admin`) for
  exactly that reason.
- Interface and module pages are **exempt from the verification gate** that
  covers ordinary bot edits, so this would be an unreviewed write path around
  the review system PickiPediaVerification exists to provide.
- Bot credentials are long-lived and sit in a vault and an environment
  variable. Compromise of one machine would become site-wide control.

So the code comes here, where a pull request is the way in, and no bot needs
write access to anything.

## How the Lua works

`Hooks::onScribuntoExternalLibraryPaths` adds this extension's `lua/`
directory to the paths Scribunto searches. Scribunto checks files **before**
wiki pages, mapping dots to directories, so:

```lua
require( 'pickipedia.instruments' )   -->   lua/pickipedia/instruments.lua
```

The `Module:` page keeps working as every `{{#invoke:}}` on the wiki expects —
it just becomes a shim:

```lua
-- Module:Instruments
return require( 'pickipedia.instruments' )
```

No syncing, no bot writing to `Module:` pages, and therefore no chance of the
repository and the wiki drifting apart. That drift is not hypothetical: it is
why the arthel studio importer was retired.

### Deploy order matters

The extension deploys through Jenkins; the wiki shim is an ordinary page edit
that takes effect instantly. **Deploy first, then replace the module page.**
The other order leaves `require()` failing on a path that does not exist yet.

## Layers

| what | where | why there |
|---|---|---|
| logic | `lua/` in this extension | reviewed, versioned, testable without a wiki |
| markup | wikitext templates on the wiki | editors can change it; VisualEditor sees it |
| styling | `resources/*.css` here | reviewed, and it lets the Lua emit classes |

The third row is what makes the first tolerable. Lua was building
`style="..."` strings by concatenation only because classes had nowhere to
live.

## Tests

Run from this directory; neither needs a wiki.

```
php tests/check-classes.php        # Lua and CSS agree on class names
lua  tests/check-instruments.lua   # instrument name -> icon family
```

`check-classes.php` guards the seam the split creates: a class name now lives
in two files, and renaming it in one fails *silently* — the page still
renders, just unstyled. It fails in both directions, so a rule for markup
nothing emits is also an error. Both run in the Jenkinsfile's
`Check Verification Gate` stage, before anything is built.
