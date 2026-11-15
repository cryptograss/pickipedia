-- Checks for Module:Studio sessions that need no wiki: what identifies a cut.
--
-- That is the one rule in the module that is its own. The rest of what it
-- does is ask MediaWiki for things (a subobject stored, a query answered, a
-- template expanded, a URL made), and a check of that written here would have
-- to play MediaWiki's part itself. This file did, until 15 Nov 2026: thirteen
-- stand-ins for mw and the frame, one of which answered fullUrl with an
-- address the wiki never makes, and a check that then asserted the stand-in.
-- So that half is checked where the real answers are, by tests/smoke.py, on a
-- running wiki: each page's source against what was rendered and stored.
--
-- Run from the extension root:  lua tests/check-studio.lua
package.path = "./lua/?.lua;" .. package.path

local failures = 0
local function check( name, got, want )
	if got == want then
		print( "  ok   " .. name )
	else
		failures = failures + 1
		print( "  FAIL " .. name .. "\n       wanted " .. tostring( want )
			.. ", got " .. tostring( got ) )
	end
end

-- No mw is defined, here or anywhere in tests/: if loading the module or
-- naming a cut ever comes to need one, this fails rather than being humoured.
local id = require( 'pickipedia.studio' )._cutId

print( "\nWhat identifies a cut:" )
check( "block height and studio, together",
	id{ blockheight = "24638686", studio = "Tunesmith Studios" },
	"24638686 Tunesmith Studios" )
check( "whatever space was typed around them",
	id{ blockheight = " 24638686 ", studio = "  Tunesmith Studios " },
	"24638686 Tunesmith Studios" )
check( "a block height alone will do",
	id{ blockheight = "24700000" }, "24700000" )
check( "a studio alone will not, and the record stands in",
	id{ studio = "Tunesmith Studios, Nashville TN", record = "4masks" }, "4masks" )
check( "the record never outranks a block height and studio",
	id{ blockheight = "24700000", studio = "a kitchen", record = "4masks" },
	"24700000 a kitchen" )
check( "an explicit cut outranks them all",
	id{ cut = "the kitchen take", blockheight = "24700000", studio = "a kitchen",
		record = "4masks" },
	"the kitchen take" )
check( "players are not identity: with nothing else there is no id, and the cut is refused",
	id{ ["Harry Clark"] = "mandolin" }, "" )

print( failures == 0 and "\nAll checks passed.\n" or ( "\n" .. failures .. " FAILED\n" ) )
os.exit( failures == 0 and 0 or 1 )
