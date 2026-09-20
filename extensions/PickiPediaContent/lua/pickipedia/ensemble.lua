-- A named lineup on a record.
--
-- A record made by more than one group of players wants to say so. 4masks
-- names four of them by Fibonacci number; another record might name them for
-- what they are. Either way it is the same shape: a label and the people in
-- it, in the order the editor chose, because on 4masks that order is
-- deliberate.
--
-- This only styles what somebody has written down. Nothing queries it, and
-- that is the honest state of it: a record's cuts already carry their own
-- personnel, so the lineups are derivable by grouping them, and one day this
-- should be the thing that gets replaced rather than the thing that gets
-- maintained. Until then, a hand-written lineup that reads well beats a
-- derived one that does not exist.

--
-- This file is the module. Module:Ensemble on the wiki is a shim that requires
-- it, so that what runs is what was reviewed. Tests live next door in
-- tests/check-ensemble.lua and run without a wiki.

local p = {}

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
		-- pairs(), not next(): Scribunto's args table is lazy, and next()
		-- reports no arguments on a call that has plenty.
		for _ in pairs( parent.args ) do
			return parent.args
		end
	end
	return frame.args
end

--- One lineup, as a row.
--
--   {{Ensemble|21|Justin Myles Holmes, Kyle Tuttle, Maddie Denton}}
--   {{Ensemble|The Rhythm Section|Jake Stargel, Skyler Golden}}
--
-- A label that is a bare number is read as an ensemble number; anything else
-- is taken as the name it is.
function p.row( frame )
	local args = callArgs( frame )
	local label = trim( args[1] or args.name )
	local members = split( args[2] or args.members )

	if #members == 0 then
		return '<span class="error">Ensemble: list its members, '
			.. "separated by commas</span>"
	end

	local links = {}
	for _, name in ipairs( members ) do
		-- One argument, so each player brings the instrument from their own
		-- page: a lineup is a standing thing, not one day's cut. Held in a
		-- nowrap span so a name never ends a line with its icon stranded at
		-- the start of the next one.
		table.insert( links, '<span style="white-space:nowrap;">'
			.. frame:expandTemplate{ title = "m", args = { name } }
			.. "</span>" )
	end

	local head = ""
	if label ~= "" then
		head = '<div style="flex:0 0 auto; align-self:center; font-size:.72em;'
			.. ' letter-spacing:.08em; text-transform:uppercase; color:#3d6b3d;'
			.. ' border:1px solid #9bb89b; border-radius:3px; padding:.05em .45em;'
			.. ' white-space:nowrap;">'
			.. ( tonumber( label ) and ( "Ensemble " .. label ) or label )
			.. "</div>"
	end

	return '<div style="display:flex; flex-wrap:wrap; gap:.2em .7em;'
		.. ' align-items:center; padding:.45em .2em;'
		.. ' border-bottom:1px solid #d4dacd;">'
		.. head
		.. '<div style="flex:1 1 14em; font-size:.95em; line-height:1.9;'
		.. ' color:#3d4a3e;">'
		.. table.concat( links, " &middot; " )
		.. "</div></div>"
end

return p
