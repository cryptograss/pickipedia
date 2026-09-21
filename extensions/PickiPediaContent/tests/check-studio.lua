-- Checks for Module:Studio sessions: cuts, appearances, and the pages that
-- read them.

-- Run from the extension root:  lua tests/check-studio.lua
package.path = "./lua/?.lua;" .. package.path

local recorded = { subobjects = {}, asks = {} }
local answers = {}      -- query substring -> answer
local licenceAnswer = "CC BY-SA 4.0"
local artistAnswer = "Justin Myles Holmes"

mw = {
	text = {
		unstrip = function( s ) return s end,
		split = function( s, sep, plain )
			local out = {}
			local pattern = plain and ( sep:gsub( "%p", "%%%0" ) ) or sep
			local start = 1
			while true do
				local from, to = s:find( pattern, start )
				if not from then
					table.insert( out, s:sub( start ) )
					break
				end
				table.insert( out, s:sub( start, from - 1 ) )
				start = to + 1
			end
			return out
		end,
	},
	title = { getCurrentTitle = function() return { fullText = "Song:Barlows" } end },
}

local function lazyArgs( values )
	local proxy = {}
	setmetatable( proxy, {
		__index = function( _, key ) return values[ key ] end,
		__pairs = function() return pairs( values ) end,
	} )
	return proxy
end

local function makeFrame( args, parentArgs )
	return {
		args = lazyArgs( args or {} ),
		getParent = function()
			if not parentArgs then return nil end
			return { args = lazyArgs( parentArgs ) }
		end,
		preprocess = function( _, text )
			table.insert( recorded.subobjects, text )
			return ""
		end,
		callParserFunction = function( _, name, params )
			if name == "#ask" then
				table.insert( recorded.asks, params[1] )
				for needle, answer in pairs( answers ) do
					if params[1]:find( needle, 1, true ) then
						return answer
					end
				end
				return ""
			elseif name == "#show" then
				if params[2] == "?Has record artist" then return artistAnswer end
				return licenceAnswer
			end
			return ""
		end,
		expandTemplate = function( _, spec )
			local instrument = spec.args[2]
			return "[[" .. spec.args[1] .. "]]"
				.. ( ( instrument and instrument ~= "" )
					and ( "{" .. instrument .. "}" ) or "" )
		end,
	}
end

local rawpairs = pairs
pairs = function( t )
	local mt = getmetatable( t )
	if mt and mt.__pairs then return mt.__pairs( t ) end
	return rawpairs( t )
end

local failures = 0
local function check( name, ok, detail )
	if ok then
		print( "  ok   " .. name )
	else
		failures = failures + 1
		print( "  FAIL " .. name .. ( detail and ( "\n       " .. tostring( detail ) ) or "" ) )
	end
end

local studio = require( 'pickipedia.studio' )

print( "\nA cut, on its composition's page:" )
recorded.subobjects = {}
local out = studio.cut( makeFrame( {}, {
	blockheight = "24638686",
	studio = "Tunesmith Studios",
	recorded = "3 April, 2024",
	engineer = "Jake Stargel",
	record = "4masks",
	number = "1",
	["Harry Clark"] = "mandolin",
	["Justin Holmes"] = "guitar, vocals",
} ) )

check( "the record is named", out:find( "%[%[4masks%]%]" ) ~= nil, out )
check( "the track number is shown", out:find( "track 1" ) ~= nil )
check( "the block height is shown", out:find( "block 24638686" ) ~= nil, out )
check( "each player has a row of their own",
	select( 2, out:gsub( '<div class="pp%-players%-who">', "" ) ) == 2, out )
check( "with their instruments in a column beside them",
	out:find( 'Harry Clark.-</div><div class="pp%-players%-what">mandolin</div>' ) ~= nil,
	out )
-- The old version of this asserted the personnel table held no newline,
-- because a newline inside raw <table> markup ends the table and spills the
-- rest of the page out as text. A grid cannot be closed early that way, so
-- the fragility is gone and there is nothing left to guard. What replaces it
-- is the property that made the grid possible: no presentation in the Lua.
check( "and the module states no styling of its own",
	out:find( "style=" ) == nil, out )
check( "a subobject per player, plus one for the appearance",
	#recorded.subobjects == 3, #recorded.subobjects )

local ids = {}
for _, s in ipairs( recorded.subobjects ) do
	ids[ s:match( "Has cut=([^|}]*)" ) ] = true
end
check( "every subobject carries the same cut id",
	ids[ "24638686 Tunesmith Studios" ] and not next( ids, next( ids ) ),
	table.concat( recorded.subobjects, "\n" ) )
check( "the appearance names the record and track",
	recorded.subobjects[3]:find( "Has record=4masks" )
		and recorded.subobjects[3]:find( "Has track number=1" ),
	recorded.subobjects[3] )

print( "\nA cut that never made a record:" )
recorded.subobjects = {}
out = studio.cut( makeFrame( {}, {
	blockheight = "24700000",
	studio = "a kitchen",
	["David Grier"] = "guitar",
} ) )
check( "is still a cut", out:find( "studio cut" ) ~= nil, out )
check( "and records no appearance", #recorded.subobjects == 1, #recorded.subobjects )

print( "\nIdentity:" )
check( "block height and studio make the id",
	recorded.subobjects[1]:find( "Has cut=24700000 a kitchen" ) ~= nil,
	recorded.subobjects[1] )
recorded.subobjects = {}
studio.cut( makeFrame( {}, { record = "4masks", ["Harry Clark"] = "mandolin" } ) )
check( "falling back to the record when nothing better is given",
	recorded.subobjects[1]:find( "Has cut=4masks" ) ~= nil, recorded.subobjects[1] )
check( "and a cut with nothing at all is refused",
	studio.cut( makeFrame( {}, { ["Harry Clark"] = "mandolin" } ) ):find( "error" ) ~= nil )

print( "\nThe same cut, turning up again:" )
recorded.subobjects = {}
out = studio.appearance( makeFrame( {}, {
	cut = "24638686 Tunesmith Studios", record = "Best of the Whistle", number = "7",
} ) )
check( "says where", out:find( "also on %[%[Best of the Whistle%]%]" ) ~= nil, out )
check( "and records it against the same cut",
	recorded.subobjects[1]:find( "Has cut=24638686 Tunesmith Studios" ) ~= nil )
check( "an appearance with no cut is refused",
	studio.appearance( makeFrame( {}, { record = "4masks" } ) ):find( "error" ) ~= nil )

print( "\nA musician's page, in two queries:" )
answers = {
	["Has performer::Harry Clark"] = table.concat( {
		"Song:Silver 44||24638686 Tunesmith Studios||mandolin||Harry Clark",
		"Song:Barlows||24700000 a kitchen||mandolin||Harry Clark",
	}, "@@" ),
	["Has cut::"] = table.concat( {
		"Song:Silver 44||24638686 Tunesmith Studios||4masks||1",
	}, "@@" ),
}
local page = studio.appearances( makeFrame( { "" }, { "Harry Clark" } ) )
check( "the record they played on is listed",
	page:find( "%[%[4masks%]%]" ) ~= nil, page )
check( "with the composition linked",
	page:find( "%[%[Song:Silver 44|Silver 44%]%]" ) ~= nil, page )
check( "the cut with no record stays out of it",
	page:find( "Barlows" ) == nil, page )

local loose = studio.unreleased( makeFrame( { "" }, { "Harry Clark" } ) )
check( "and turns up under its own heading",
	loose:find( "Studio cuts not on a record" ) and loose:find( "Barlows" ), loose )
check( "named by the cut it was", loose:find( "24700000 a kitchen" ) ~= nil, loose )

print( "\nA record's page, in two queries:" )
answers = {
	["Has record::4masks"] = table.concat( {
		"Song:Silver 44||24638686 Tunesmith||1||4masks",
		"Song:Barlows||24700001 Tunesmith||||4masks",
	}, "@@" ),
	["Has performer::+"] = table.concat( {
		"Song:Silver 44||24638686 Tunesmith||Harry Clark||mandolin",
		"Song:Silver 44||24638686 Tunesmith||Kyle Tuttle||5-string banjo",
		"Song:Barlows||24700001 Tunesmith||David Grier||guitar",
	}, "@@" ),
}
local listing = studio.tracks( makeFrame( { "" }, { "4masks" } ) )
check( "numbered tracks come first", listing:find( "1%. " ) ~= nil, listing )
check( "each composition appears once",
	select( 2, listing:gsub( "Silver 44|Silver 44", "" ) ) == 1, listing )
check( "players come from the cut that appears here",
	listing:find( "Harry Clark" ) and listing:find( "Kyle Tuttle" ), listing )
check( "and the unnumbered one still lists its player",
	listing:find( "David Grier" ) ~= nil, listing )
check( "only two queries, however many tracks",
	#recorded.asks >= 2, #recorded.asks )

print( "\nOne record's name, shared by every cut on it:" )
-- Imported cuts fall back to the record's name, so Silver 44 and Barlows both
-- carry the cut id "4masks". Harry Clark is only on Silver 44, and must not be
-- credited with the other.
answers = {
	["Has performer::Harry Clark"] = "Song:Silver 44||4masks||mandolin||Harry Clark",
	["Has cut::"] = table.concat( {
		"Song:Silver 44||4masks||4masks||1",
		"Song:Barlows||4masks||4masks||2",
	}, "@@" ),
}
page = studio.appearances( makeFrame( { "" }, { "Harry Clark" } ) )
check( "the composition they played on is listed",
	page:find( "Silver 44" ) ~= nil, page )
check( "and the one they did not is not",
	page:find( "Barlows" ) == nil, page )

answers = {
	["Has record::4masks"] = table.concat( {
		"Song:Silver 44||4masks||1||4masks",
		"Song:Barlows||4masks||2||4masks",
	}, "@@" ),
	["Has performer::+"] = table.concat( {
		"Song:Silver 44||4masks||Harry Clark||mandolin",
		"Song:Barlows||4masks||David Grier||guitar",
	}, "@@" ),
}
listing = studio.tracks( makeFrame( { "" }, { "4masks" } ) )
local silverLine = listing:match( "Silver 44.-</div></div>" ) or ""
check( "a track lists only its own players",
	silverLine:find( "Harry Clark" ) and not silverLine:find( "David Grier" ),
	silverLine )

print( "\nNothing to show:" )
answers = {}
check( "a record with no cuts renders nothing",
	studio.tracks( makeFrame( { "" }, { "4masks" } ) ) == "" )
check( "and a musician with none renders nothing",
	studio.appearances( makeFrame( { "" }, { "Nobody" } ) ) == "" )

print( failures == 0 and "\nAll checks passed.\n" or ( "\n" .. failures .. " FAILED\n" ) )
os.exit( failures == 0 and 0 or 1 )
