-- Which icon stands for an instrument.
--
-- An instrument is recorded as it was played: "5-string banjo", not "banjo".
-- That detail is the point. Whether Cory brought a five-string or a tenor,
-- whether the banjo is Scruggs or clawhammer, is a fact about the cut, and
-- rounding it off to fit a picture would be throwing away the better half of
-- what we know.
--
-- But there are eleven icons and there will never be one per variant. So the
-- name and the icon are separated: the name is kept and shown verbatim, and
-- this decides which family the name belongs to. A name with no family shows
-- no icon, which is the correct outcome for a cello -- far better than the
-- broken image that "File:Instrument-icon-cello.png" produced before.
--
-- This file is the module. Module:Instruments on the wiki is a shim that
-- requires it, so that what runs is what was reviewed. Tests live next door
-- in tests/check-instruments.lua and run without a wiki.

local p = {}

-- The icons that exist, as File:Instrument-icon-<family>.png.
local FAMILIES = {
	"autoharp", "banjo", "bass", "dobro", "fiddle", "guitar",
	"mandolin", "percussion", "tin whistle", "ukulele", "vocals",
}

-- Drawn at a playing angle rather than upright.
local ROTATED = {
	banjo = true, guitar = true, mandolin = true, ukulele = true,
}

-- Names that do not contain their family's name. A name that does contain it
-- needs no entry: "5-string banjo", "tenor guitar" and "clawhammer banjo"
-- are all found without being listed.
--
-- Matched against the whole name first, then word by word, so "bass guitar"
-- lands on bass rather than on guitar.
local ALIASES = {
	["bass guitar"] = "bass",
	["electric bass"] = "bass",
	["upright"] = "bass",
	["double bass"] = "bass",
	["doghouse"] = "bass",

	["violin"] = "fiddle",
	["viola"] = "fiddle",

	["drums"] = "percussion",
	["drum"] = "percussion",
	["washboard"] = "percussion",
	["spoons"] = "percussion",
	["bones"] = "percussion",

	["vocal"] = "vocals",
	["voice"] = "vocals",
	["singing"] = "vocals",
	["throatsinging"] = "vocals",
	["throat singing"] = "vocals",
	["harmony"] = "vocals",
	["spoken word"] = "vocals",

	["whistle"] = "tin whistle",
	["six-whistle"] = "tin whistle",
	["pennywhistle"] = "tin whistle",
	["flute"] = "tin whistle",
	["recorder"] = "tin whistle",

	["resonator"] = "dobro",
	["squareneck"] = "dobro",

	["uke"] = "ukulele",
}

local function normalise( name )
	return ( tostring( name or "" ):lower():gsub( "%s+", " " ):gsub( "^ ", "" ):gsub( " $", "" ) )
end

-- Does needle appear in haystack as a whole word or phrase? Without this,
-- "bass" would be found inside "bassoon" and a bassoon would be a bass.
local function containsPhrase( haystack, needle )
	local from = 1
	while true do
		local start, stop = haystack:find( needle, from, true )
		if not start then return false end
		local before = start == 1 and "" or haystack:sub( start - 1, start - 1 )
		local after = haystack:sub( stop + 1, stop + 1 )
		if not before:match( "%a" ) and not after:match( "%a" ) then
			return true
		end
		from = start + 1
	end
end

--- The family an instrument belongs to.
--
-- @param name an instrument as somebody wrote it down.
-- @return the family name, or "" when nothing here covers it.
function p._family( name )
	name = normalise( name )
	if name == "" then return "" end

	-- The whole name, exactly. This is what lets "bass guitar" be a bass:
	-- it is settled before anything goes looking for family names inside.
	for _, family in ipairs( FAMILIES ) do
		if name == family then return family end
	end
	if ALIASES[ name ] then return ALIASES[ name ] end

	-- A family named within the name. Longest first, so a hypothetical
	-- "tin whistle" beats a shorter match that overlaps it.
	local byLength = {}
	for _, family in ipairs( FAMILIES ) do table.insert( byLength, family ) end
	table.sort( byLength, function( a, b ) return #a > #b end )
	for _, family in ipairs( byLength ) do
		if containsPhrase( name, family ) then return family end
	end

	-- Failing that, an aliased word inside the name: "wood flute", "electric
	-- fiddle", "tenor uke".
	for alias, family in pairs( ALIASES ) do
		if containsPhrase( name, alias ) then return family end
	end

	return ""
end

--- The icon for an instrument, as wikitext, or nothing.
--
-- Presentation is carried by classes from ext.pickipediaContent.css. The one
-- exception is the box's width and height, which are inline because they are
-- not presentation: they mirror the size of the thumbnail this asks
-- MediaWiki to generate, and a stylesheet guessing at that would be a
-- stylesheet that can disagree with the image.
--
-- @param name the instrument, shown verbatim in the tooltip.
-- @param size pixel height of the icon.
-- @param tuck when set, pull the icon back over the name it follows — the
--     tight inline form used beside a musician's link.
function p._badge( name, size, tuck )
	local family = p._family( name )
	if family == "" then return "" end

	size = tonumber( size ) or 20

	local classes = { "pp-instrument" }
	if tuck then
		table.insert( classes, "pp-instrument--tuck" )
	end
	if ROTATED[ family ] then
		table.insert( classes, "pp-instrument--angled" )
	end

	local label = normalise( name )
	return '<span class="' .. table.concat( classes, " " )
		.. '" title="' .. label .. '">'
		.. '<span class="pp-instrument__box" style="width:' .. size
		.. "px;height:" .. size .. 'px;">'
		.. "[[File:Instrument-icon-" .. family .. ".png|x" .. size .. "px|"
		.. label .. "|link=]]"
		.. "</span></span>"
end

-- {{#invoke:Instruments|family|5-string banjo}} -> banjo
function p.family( frame )
	return p._family( frame.args[1] )
end

-- {{#invoke:Instruments|badge|5-string banjo|size=18|tuck=1}}
function p.badge( frame )
	local args = frame.args
	return p._badge( args[1], args.size or args[2],
		args.tuck ~= nil and args.tuck ~= "" )
end

return p
