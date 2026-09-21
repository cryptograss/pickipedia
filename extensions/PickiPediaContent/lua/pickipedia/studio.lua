-- Studio cuts: a particular recording of a composition, and where it turns up.
--
-- Three things, kept apart because they really are three things:
--
--   the composition   the page itself, in Song:            (PickiPedia:Compositions)
--   a cut             one recording of it, by one lineup, on one day
--   an appearance     that cut turning up on a record
--
-- A cut has zero or more appearances. Zero is ordinary: plenty of things are
-- cut in a studio without ever landing on an album. More than one happens the
-- moment a compilation exists, and the point of giving a cut its own identity
-- is that the two appearances can then say they are the same performance
-- rather than each claiming its own.
--
-- A cut is identified by block height and studio, which is always
-- disambiguating and does not depend on anybody agreeing what to call a
-- session.
--
--
-- This file is the module. Module:Studio sessions on the wiki is a shim that requires
-- it, so that what runs is what was reviewed. Tests live next door in
-- tests/check-studio.lua and run without a wiki.
--
-- Note for future editors: do not wrap this header in a --[==[ ]==] block
-- comment containing wiki link syntax. Lua reads the inner brackets as nested
-- long brackets and refuses to load the module.

local p = {}

-- Parameters of {{Studio cut}} that describe the session rather than name a
-- player. Anything else is a musician.
local NOT_A_PLAYER = {
	cut = true,
	blockheight = true,
	studio = true,
	recorded = true,
	engineer = true,
	record = true,
	number = true,
}

local function trim( s )
	return ( s or "" ):gsub( "^%s*(.-)%s*$", "%1" )
end

local function split( raw )
	local out = {}
	for part in ( ( raw or "" ) .. "," ):gmatch( "%s*(.-)%s*," ) do
		if part ~= "" then
			table.insert( out, part )
		end
	end
	return out
end

local function callArgs( frame )
	local parent = frame:getParent()
	if parent then
		-- pairs(), not next(): Scribunto's args table is lazy, so next()
		-- reports no arguments on a call that has plenty.
		for _ in pairs( parent.args ) do
			return parent.args
		end
	end
	return frame.args
end

-- Everything the parser wraps around a value that is not part of the value:
-- the strip marker, SMW's span markup, and SMW's own [[SMW::off]] switch.
local function plain( text )
	text = mw.text.unstrip( text or "" )
	text = text:gsub( "\127[^\127]*\127", "" ):gsub( "<[^>]+>", "" )
	return ( text:gsub( "%[%[SMW::o[nf]f?%]%]", "" ) )
end

local function escape( value )
	return ( value:gsub( "|", "{{!}}" ):gsub( "=", "{{=}}" ) )
end

local function bare( title )
	return ( title:gsub( "^[^:]+:", "" ) )
end

local function subobject( frame, parts )
	frame:preprocess( "{{#subobject:|" .. table.concat( parts, "|" ) .. "}}" )
end

-- What identifies this cut.
--
-- Block height and studio, per the convention: a block height is a time nobody
-- has to agree on the name of.
--
-- Failing that, an explicit label, and failing that the record it was cut for
-- — which is a placeholder, not an identity. Two records naming the same cut
-- that way cannot be told they are the same performance; that is exactly what
-- recording the block height fixes.
--
-- Either way it identifies the cut *within this composition*, never across
-- compositions: five tunes cut in one session share a block height, and every
-- imported cut on a record shares that record's name. See key().
local function cutId( args )
	local given = trim( args.cut )
	if given ~= "" then
		return given
	end
	local height, studio = trim( args.blockheight ), trim( args.studio )
	if height ~= "" and studio ~= "" then
		return height .. " " .. studio
	end
	if height ~= "" then
		return height
	end
	return trim( args.record )
end

local function players( args )
	local named = {}
	for name, value in pairs( args ) do
		if type( name ) == "string" and not NOT_A_PLAYER[ name ] then
			table.insert( named, { name = trim( name ), instruments = trim( value ) } )
		end
	end
	table.sort( named, function( a, b ) return a.name < b.name end )
	return named
end

-- One recording of this composition.
function p.cut( frame )
	local args = callArgs( frame )
	local id = cutId( args )
	if id == "" then
		return '<span class="error">Studio cut: give it a block height and '
			.. 'studio, or a record it was cut for</span>'
	end

	local record, number = trim( args.record ), trim( args.number )

	local shown = {}
	for _, player in ipairs( players( args ) ) do
		local parts = {
			"Has cut=" .. escape( id ),
			"Has performer=" .. escape( player.name ),
		}
		for _, instrument in ipairs( split( player.instruments ) ) do
			table.insert( parts, "Has instrument=" .. escape( instrument ) )
		end
		subobject( frame, parts )

		-- The icon is the instrument played on this cut, not whatever the
		-- musician's page calls their main one.
		local first = split( player.instruments )[1] or ""
		table.insert( shown, {
			who = frame:expandTemplate{ title = "m", args = { player.name, first } },
			instruments = player.instruments,
		} )
	end

	-- The common case: a cut made for one record says so here, rather than
	-- needing a second call to state the obvious.
	if record ~= "" then
		local parts = { "Has cut=" .. escape( id ), "Has record=" .. escape( record ) }
		if number ~= "" then
			table.insert( parts, "Has track number=" .. escape( number ) )
		end
		subobject( frame, parts )
	end

	local session = {}
	for _, field in ipairs( { "recorded", "studio", "engineer" } ) do
		local value = trim( args[ field ] )
		if value ~= "" then
			table.insert( session, field == "engineer" and ( "engineer " .. value ) or value )
		end
	end
	if trim( args.blockheight ) ~= "" then
		table.insert( session, "block " .. trim( args.blockheight ) )
	end

	local heading
	if record ~= "" then
		heading = "[[" .. record .. "]]"
			.. ( number ~= "" and ( ' <span class="pp-qualifier">track '
				.. number .. "</span>" ) or "" )
	else
		-- A cut with nowhere to appear is not a lesser thing; say what it is.
		heading = '<span class="pp-unreleased">studio cut</span>'
	end

	local out = { '<div class="pp-row pp-row--cut">' }
	table.insert( out, '<div class="pp-row-head">' .. heading .. "</div>" )
	-- A lineup reads down, not across. On a composition's page the personnel
	-- are the substance — who was in the room, on what — and a run-on line of
	-- names separated by dots makes them a caption. One player per row, with
	-- the instruments in their own column, is a session sheet.
	if #shown > 0 then
		local rows = {}
		for _, player in ipairs( shown ) do
			table.insert( rows,
				'<div class="pp-players-who">' .. player.who .. "</div>"
				.. '<div class="pp-players-what">' .. player.instruments
				.. "</div>" )
		end
		-- A two-column grid, not a table. It lines up the same way and is not
		-- made of markup the parser can close early: a newline inside a raw
		-- <table> ends it and spills the rest onto the page as text.
		table.insert( out, '<div class="pp-players">'
			.. table.concat( rows, "" ) .. "</div>" )
	end
	if #session > 0 then
		table.insert( out, '<div class="pp-row-note">'
			.. table.concat( session, " &middot; " ) .. "</div>" )
	end
	table.insert( out, "</div>" )
	return table.concat( out, "\n" )
end

-- This cut turning up somewhere else: a compilation, a reissue, a single.
function p.appearance( frame )
	local args = callArgs( frame )
	local id, record = trim( args.cut ), trim( args.record )
	if id == "" or record == "" then
		return '<span class="error">Cut appears on: needs both a cut and a record</span>'
	end
	local number = trim( args.number )

	local parts = { "Has cut=" .. escape( id ), "Has record=" .. escape( record ) }
	if number ~= "" then
		table.insert( parts, "Has track number=" .. escape( number ) )
	end
	subobject( frame, parts )

	return '<div class="pp-also">also on [['
		.. record .. "]]"
		.. ( number ~= "" and ( ", track " .. number ) or "" ) .. "</div>"
end

local function property( frame, page, name )
	return trim( plain( frame:callParserFunction( "#show", {
		page, "?" .. name, "link=none", "default=",
	} ) ) )
end

local function freelyLicensed( frame, record )
	local licence = property( frame, record, "Has license" )
	local lower = licence:lower()
	local free = lower:find( "cc " ) or lower:find( "creative commons" )
		or lower:find( "cc0" ) or lower:find( "public domain" )
	return ( free ~= nil ), licence
end

-- Ask a query, and get back rows keyed by the names the query gave its
-- columns.
--
-- Template:Studio appearance row emits the values joined by ||, positionally,
-- because that is all a result template can do. Reading them back as row[1]..
-- row[4] — or worse, row.b and row.c — makes every caller a puzzle, so the
-- labels declared in the printouts ("?Has cut=cut") are used as the keys.
local function rows( frame, query, printouts, mainlabel )
	local names = { mainlabel }
	for _, printout in ipairs( printouts ) do
		table.insert( names, printout:match( "=([^=]*)$" ) or printout )
	end

	local args = { query }
	for _, printout in ipairs( printouts ) do
		table.insert( args, printout )
	end
	for _, option in ipairs( {
		"mainlabel=" .. mainlabel, "format=plainlist", "link=none", "sep=@@",
		"template=Studio appearance row", "searchlabel=", "limit=500",
	} ) do
		table.insert( args, option )
	end

	local raw = plain( frame:callParserFunction( "#ask", args ) )
	local out = {}
	if trim( raw ) == "" then
		return out
	end
	for _, line in ipairs( mw.text.split( raw, "@@", true ) ) do
		local values = mw.text.split( line, "||", true )
		if trim( values[1] or "" ) ~= "" then
			local row = {}
			for index, name in ipairs( names ) do
				local value = trim( values[ index ] or "" )
				if index == 1 then
					-- A subobject's subject prints as "Song:Barlows#_abc123";
					-- the page is the part before the fragment.
					value = trim( value:match( "^([^#]*)" ) or value )
				end
				row[ name ] = value
			end
			table.insert( out, row )
		end
	end
	return out
end

-- A cut's identity is the composition it belongs to plus its own id.
--
-- Never the id alone. Two tunes cut in one session share a block height and a
-- studio, and every imported cut on one record falls back to that record's
-- name — so joining on the id by itself put Harry Clark on a Barlows Jig he
-- never played, because he was on another 4masks track.
local function key( song, cut )
	return song .. "\0" .. cut
end

-- Where a set of cuts appear, asked in one query rather than one per cut.
--
-- A record with a dozen tracks would otherwise mean a dozen queries; SMW takes
-- alternatives with ||, so it is one. The results are then matched back by
-- composition and cut together.
local function appearancesOf( frame, ids )
	local wanted, seen = {}, {}
	for _, cut in pairs( ids ) do
		if not seen[ cut ] then
			seen[ cut ] = true
			table.insert( wanted, cut )
		end
	end
	if #wanted == 0 then
		return {}
	end
	table.sort( wanted )

	local found = rows( frame, "[[Has cut::" .. table.concat( wanted, "||" ) .. "]]", {
		"?Has cut=cut",
		"?Has record=record",
		"?Has track number=number",
	}, "song" )

	local byCut = {}
	for _, row in ipairs( found ) do
		if row.record ~= "" then
			local id = key( row.song, row.cut )
			byCut[ id ] = byCut[ id ] or {}
			table.insert( byCut[ id ], {
				song = row.song, record = row.record, number = tonumber( row.number ),
			} )
		end
	end
	return byCut
end

local function subjectOf( frame )
	local given = trim( callArgs( frame )[1] or frame.args[1] )
	if given ~= "" then
		return given
	end
	return mw.title.getCurrentTitle().fullText
end

-- Every cut a musician played on, grouped by the record it appears on.
--
-- @param wanted "free" for records anybody may share, "rest" for the others,
--   "none" for cuts that appear on no record at all.
local function appearances( frame, wanted, heading )
	local who = subjectOf( frame )
	local mine = rows( frame, "[[Has performer::" .. who .. "]]", {
		"?Has cut=cut",
		"?Has instrument=instrument",
		"?Has performer=performer",
	}, "song" )

	local ids, instruments, songOf, cutOf = {}, {}, {}, {}
	for _, row in ipairs( mine ) do
		if row.cut ~= "" then
			local id = key( row.song, row.cut )
			ids[ id ] = row.cut
			songOf[ id ] = row.song
			cutOf[ id ] = row.cut
			for _, one in ipairs( split( row.instrument ) ) do
				instruments[ id ] = instruments[ id ] or {}
				table.insert( instruments[ id ], one )
			end
		end
	end

	local where = appearancesOf( frame, ids )

	-- Grouped by record, so a picker's page reads as a list of records rather
	-- than a list of sessions.
	local order, byRecord = {}, {}
	local loose = {}
	for id in pairs( ids ) do
		local places = where[ id ]
		if places and #places > 0 then
			for _, place in ipairs( places ) do
				if not byRecord[ place.record ] then
					byRecord[ place.record ] = { songs = {}, instruments = {}, seen = {} }
					table.insert( order, place.record )
				end
				local entry = byRecord[ place.record ]
				if not entry.seen[ place.song ] then
					entry.seen[ place.song ] = true
					table.insert( entry.songs, { title = place.song, number = place.number } )
				end
				for _, one in ipairs( instruments[ id ] or {} ) do
					if not entry.instruments[ one ] then
						entry.instruments[ one ] = true
						table.insert( entry.instruments, one )
					end
				end
			end
		else
			table.insert( loose, { song = songOf[ id ], id = cutOf[ id ],
				instruments = instruments[ id ] or {} } )
		end
	end

	local blocks = {}

	if wanted == "none" then
		table.sort( loose, function( a, b ) return a.song < b.song end )
		for _, cut in ipairs( loose ) do
			table.insert( blocks,
				'<div class="pp-row">'
				.. '<div class="pp-row-head">[[' .. cut.song .. "|"
				.. bare( cut.song ) .. "]]</div>"
				.. '<div class="pp-row-detail">'
				.. ( #cut.instruments > 0
					and ( table.concat( cut.instruments, ", " ) .. " &middot; " ) or "" )
				.. cut.id .. "</div></div>" )
		end
	else
		table.sort( order )
		for _, record in ipairs( order ) do
			local entry = byRecord[ record ]
			local isFree, licence = freelyLicensed( frame, record )
			if ( wanted == "free" ) == isFree then
				table.sort( entry.songs, function( a, b )
					if a.number and b.number then return a.number < b.number end
					return a.title < b.title
				end )

				local titles = {}
				for _, song in ipairs( entry.songs ) do
					table.insert( titles,
						"[[" .. song.title .. "|" .. bare( song.title ) .. "]]" )
				end

				local artist = property( frame, record, "Has record artist" )
				local line = {
					'<div class="pp-row">',
					'<div class="pp-row-head">[[' .. record .. "]]",
				}
				if artist ~= "" then
					table.insert( line, ' <span class="pp-by">by [['
						.. artist .. "]]</span>" )
				end
				if isFree and licence ~= "" then
					table.insert( line, ' <span class="pp-chip">' .. licence .. "</span>" )
				end
				table.insert( line, "</div>" )
				table.insert( line, '<div class="pp-row-detail">'
					.. ( #entry.instruments > 0
						and ( table.concat( entry.instruments, ", " ) .. " &middot; " ) or "" )
					.. table.concat( titles, ", " ) .. "</div>" )
				table.insert( line, "</div>" )
				table.insert( blocks, table.concat( line, "" ) )
			end
		end
	end

	if #blocks == 0 then
		return ""
	end
	table.insert( blocks, 1, "== " .. heading .. " ==" )
	return table.concat( blocks, "\n" )
end

function p.appearances( frame )
	return appearances( frame, "free",
		"[[PickiPedia:Creative Commons|Creative Commons]] Studio Work" )
end

function p.other( frame )
	return appearances( frame, "rest", "Other studio work" )
end

-- Cuts that are on no record at all — a session for its own sake, a video, a
-- thing that was never finished. Worth saying: it happened, and they played on
-- it.
function p.unreleased( frame )
	return appearances( frame, "none", "Studio cuts not on a record" )
end

-- The track listing of a record, assembled from the cuts that appear on it.
function p.tracks( frame )
	local record = subjectOf( frame )
	local places = rows( frame, "[[Has record::" .. record .. "]]", {
		"?Has cut=cut",
		"?Has track number=number",
		"?Has record=record",
	}, "song" )

	local ids, order, bySong = {}, {}, {}
	for _, row in ipairs( places ) do
		if row.cut ~= "" then
			ids[ key( row.song, row.cut ) ] = row.cut
			if not bySong[ row.song ] then
				bySong[ row.song ] = { number = tonumber( row.number ), cuts = {} }
				table.insert( order, row.song )
			end
			local entry = bySong[ row.song ]
			entry.number = entry.number or tonumber( row.number )
			table.insert( entry.cuts, row.cut )
		end
	end

	if #order == 0 then
		return ""
	end

	-- Who played, for every cut on this record, in one more query.
	local wanted, seen = {}, {}
	for _, cut in pairs( ids ) do
		if not seen[ cut ] then
			seen[ cut ] = true
			table.insert( wanted, cut )
		end
	end
	table.sort( wanted )
	local personnel = rows( frame,
		"[[Has cut::" .. table.concat( wanted, "||" ) .. "]][[Has performer::+]]", {
			"?Has cut=cut",
			"?Has performer=performer",
			"?Has instrument=instrument",
		}, "song" )

	local byCut = {}
	for _, row in ipairs( personnel ) do
		if row.cut ~= "" and row.performer ~= "" then
			local id = key( row.song, row.cut )
			byCut[ id ] = byCut[ id ] or {}
			table.insert( byCut[ id ],
				{ name = row.performer, instrument = split( row.instrument )[1] or "" } )
		end
	end

	table.sort( order, function( a, b )
		local na, nb = bySong[ a ].number, bySong[ b ].number
		if na and nb then return na < nb end
		if na then return true end
		if nb then return false end
		return a < b
	end )

	local out = {}
	for _, song in ipairs( order ) do
		local entry = bySong[ song ]

		local seen, shown = {}, {}
		for _, cut in ipairs( entry.cuts ) do
			for _, player in ipairs( byCut[ key( song, cut ) ] or {} ) do
				if not seen[ player.name ] then
					seen[ player.name ] = true
					table.insert( shown, player )
				end
			end
		end
		table.sort( shown, function( a, b ) return a.name < b.name end )

		local links = {}
		for _, player in ipairs( shown ) do
			-- Nowrap, so a name never ends a line with its icon stranded at
			-- the start of the next one.
			table.insert( links, '<span class="pp-nowrap">'
				.. frame:expandTemplate{
					title = "m", args = { player.name, player.instrument } }
				.. "</span>" )
		end

		local line = { '<div class="pp-row">' }
		table.insert( line, '<div class="pp-row-head">'
			.. ( entry.number and ( entry.number .. ". " ) or "" )
			.. "[[" .. song .. "|" .. bare( song ) .. "]]</div>" )
		if #links > 0 then
			table.insert( line, '<div class="pp-row-detail pp-row-detail--roomy">'
				.. table.concat( links, " &middot; " ) .. "</div>" )
		end
		table.insert( line, "</div>" )
		table.insert( out, table.concat( line, "" ) )
	end
	return table.concat( out, "\n" )
end

return p
