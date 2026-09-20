-- Checks for Module:Instruments.
-- Run from the extension root:  lua tests/check-instruments.lua
package.path = "./lua/?.lua;" .. package.path

local failures = 0
local function check( name, ok, detail )
	if ok then
		print( "  ok   " .. name )
	else
		failures = failures + 1
		print( "  FAIL " .. name .. ( detail and ( "\n       " .. tostring( detail ) ) or "" ) )
	end
end

local ins = require( "pickipedia.instruments" )
local function family( n ) return ins._family( n ) end

print( "\nEvery instrument in the live data:" )
local live = {
	["5-string banjo"] = "banjo",
	["bass"] = "bass",
	["cello"] = "",
	["dobro"] = "dobro",
	["drums"] = "percussion",
	["fiddle"] = "fiddle",
	["guitar"] = "guitar",
	["mandolin"] = "mandolin",
	["melodica"] = "",
	["six-whistle"] = "tin whistle",
	["spoken word"] = "vocals",
	["throatsinging"] = "vocals",
	["vocals"] = "vocals",
	["wood flute"] = "tin whistle",
}
for name, want in pairs( live ) do
	check( ( "%-20s -> %s" ):format( name, want == "" and "(no icon)" or want ),
		family( name ) == want, family( name ) )
end

print( "\nVariants we do not have to enumerate:" )
for _, case in ipairs( {
	{ "clawhammer banjo", "banjo" },
	{ "tenor banjo", "banjo" },
	{ "four-string banjo", "banjo" },
	{ "Scruggs-style banjo", "banjo" },
	{ "resonator guitar", "guitar" },
	{ "12-string guitar", "guitar" },
	{ "octave mandolin", "mandolin" },
	{ "harmony vocals", "vocals" },
	{ "low whistle", "tin whistle" },
} ) do
	check( case[1] .. " -> " .. case[2], family( case[1] ) == case[2], family( case[1] ) )
end

print( "\nThe head of the name wins where two families could claim it:" )
check( "a bass guitar is a bass", family( "bass guitar" ) == "bass", family( "bass guitar" ) )
check( "an upright bass is a bass", family( "upright bass" ) == "bass" )

print( "\nA family name inside a word is not that family:" )
check( "a bassoon is not a bass", family( "bassoon" ) == "", family( "bassoon" ) )
check( "a guitarron is not a guitar", family( "guitarron" ) == "", family( "guitarron" ) )

print( "\nWriting it down loosely still works:" )
check( "case", family( "5-String Banjo" ) == "banjo" )
check( "stray spaces", family( "  5-string   banjo " ) == "banjo" )
check( "nothing at all", family( "" ) == "" )
check( "nil", family( nil ) == "" )

print( "\nThe badge:" )
local badge = ins._badge( "5-string banjo", 20 )
check( "names the family's file",
	badge:find( "File:Instrument%-icon%-banjo%.png" ) ~= nil, badge )
check( "but says the whole instrument in the tooltip",
	badge:find( 'title="5%-string banjo"' ) ~= nil, badge )
check( "a banjo is drawn at an angle",
	badge:find( "pp%-instrument%-%-angled" ) ~= nil, badge )
check( "a fiddle is not",
	ins._badge( "fiddle", 20 ):find( "angled" ) == nil )
check( "an instrument with no icon shows nothing",
	ins._badge( "cello", 20 ) == "", ins._badge( "cello", 20 ) )
check( "the size is honoured", ins._badge( "fiddle", 18 ):find( "x18px" ) ~= nil )
check( "and the box is drawn to match the thumbnail it asked for",
	ins._badge( "fiddle", 18 ):find( "width:18px;height:18px" ) ~= nil,
	ins._badge( "fiddle", 18 ) )
check( "tucking pulls it back over the name",
	ins._badge( "fiddle", 18, true ):find( "pp%-instrument%-%-tuck" ) ~= nil )
check( "and is off by default",
	ins._badge( "fiddle", 18 ):find( "tuck" ) == nil )
check( "presentation is carried by classes, not inline style",
	select( 2, ins._badge( "5-string banjo", 20 ):gsub( 'style="', "" ) ) == 1,
	ins._badge( "5-string banjo", 20 ) )

print( "\nCalled as a template:" )
check( "family", ins.family( { args = { "clawhammer banjo" } } ) == "banjo" )
check( "badge with named size",
	ins.badge( { args = { "fiddle", size = "18" } } ):find( "x18px" ) ~= nil )
check( "badge with an empty tuck is untucked",
	ins.badge( { args = { "fiddle", size = "18", tuck = "" } } ):find( "tuck" ) == nil )

print( failures == 0 and "\nAll checks passed.\n" or ( "\n" .. failures .. " FAILED\n" ) )
os.exit( failures == 0 and 0 or 1 )
