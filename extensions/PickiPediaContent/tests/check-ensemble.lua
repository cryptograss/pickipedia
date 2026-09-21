-- Checks for Module:Ensemble.
-- Run from the extension root:  lua tests/check-ensemble.lua
package.path = "./lua/?.lua;" .. package.path

local function lazyArgs( values )
	local proxy = {}
	setmetatable( proxy, {
		__index = function( _, key ) return values[ key ] end,
		__pairs = function() return pairs( values ) end,
	} )
	return proxy
end

local rawpairs = pairs
pairs = function( t )
	local mt = getmetatable( t )
	if mt and mt.__pairs then return mt.__pairs( t ) end
	return rawpairs( t )
end

local function makeFrame( parentArgs )
	return {
		args = lazyArgs( {} ),
		getParent = function() return { args = lazyArgs( parentArgs ) } end,
		expandTemplate = function( _, spec )
			local instrument = spec.args[2]
			return "[[" .. spec.args[1] .. "]]"
				.. ( ( instrument and instrument ~= "" )
					and ( "{" .. instrument .. "}" ) or "" )
		end,
	}
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

local ensemble = require( 'pickipedia.ensemble' )

print( "\nA numbered lineup:" )
local row = ensemble.row( makeFrame( {
	"21", "Justin Myles Holmes, Kyle Tuttle, Maddie Denton",
} ) )
check( "a bare number is an Ensemble", row:find( "Ensemble 21" ) ~= nil, row )
check( "every member is linked",
	row:find( "%[%[Kyle Tuttle%]%]" ) and row:find( "%[%[Maddie Denton%]%]" ), row )
check( "in the order they were given, which is deliberate",
	row:find( "Justin Myles Holmes" ) < row:find( "Kyle Tuttle" ), row )
check( "and with no instrument forced on them — their own page says",
	row:find( "{" ) == nil, row )
check( "separated, not run together",
	row:find( "&middot;" ) ~= nil, row )

print( "\nA lineup with a name:" )
local named = ensemble.row( makeFrame( {
	"The Rhythm Section", "Jake Stargel, Skyler Golden",
} ) )
check( "is left as it was written",
	named:find( "The Rhythm Section" ) and not named:find( "Ensemble" ), named )

print( "\nEdges:" )
check( "no label is still a lineup",
	ensemble.row( makeFrame( { "", "Jake Stargel" } ) ):find( "Jake Stargel" ) ~= nil )
check( "one member needs no separator",
	ensemble.row( makeFrame( { "89", "David Grier" } ) ):find( "&middot;" ) == nil )
check( "nobody in it is refused",
	ensemble.row( makeFrame( { "21" } ) ):find( "error" ) ~= nil )
check( "a trailing comma is not a member",
	select( 2, ensemble.row( makeFrame( { "21", "David Grier, " } ) )
		:gsub( "%[%[", "" ) ) == 1 )
check( "spaces around names are trimmed",
	ensemble.row( makeFrame( { "21", "  David Grier ,  Kyle Tuttle " } ) )
		:find( "%[%[David Grier%]%]" ) ~= nil )
check( "named parameters work too",
	ensemble.row( makeFrame( { name = "34", members = "David Grier" } ) )
		:find( "Ensemble 34" ) ~= nil )

print( "\nIt lays out:" )
check( "as a row that wraps on a narrow screen",
	row:find( 'class="pp%-row pp%-lineup"' ) ~= nil, row )
check( "but never between a name and its icon",
	select( 2, row:gsub( '<span class="pp%-nowrap">', "" ) ) == 3, row )
check( "and it carries no styling of its own",
	row:find( "style=" ) == nil, row )

print( failures == 0 and "\nAll checks passed.\n" or ( "\n" .. failures .. " FAILED\n" ) )
os.exit( failures == 0 and 0 or 1 )
