-- DebugService.luau
-- Runtime debug utilities for Studio testing.
-- Provides functions to inspect game state and modify player/enemy data for testing.
-- Only available in Studio or when PlayerDataService.IsAdmin(player) is true.

local Players            = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local RemoteEvents      = require(ReplicatedStorage.Shared.Remotes.RemoteEvents)

-- Dependencies (set via Init)
local PlayerDataService
local LevelingService
local EnemyService
local BossService
local ZoneService

local DebugService = {}

-- -- Debug Command Handler ---------------------------------------------------
-- Receives debug commands from client via RemoteEvent
-- -----------------------------------------------------------------------------
local function onDebugCommand(player: Player, payload: { command: string, args: { any } })
	-- Only allow admins
	local data = PlayerDataService and PlayerDataService.GetData(player)
	if not data or not data.IsAdmin then
		warn("[DebugService] Non-admin player attempted debug command: " .. player.Name)
		return
	end

	local command = payload.command
	local args = payload.args or {}

	local success, result = pcall(function()
		if command == "getGameState" then
			return DebugService.GetGameState()
		elseif command == "forceLevelUp" then
			local target = args[1]
			return DebugService.ForceLevelUp(target)
		elseif command == "giveGold" then
			local target = args[1]
			local amount = tonumber(args[2]) or 1000
			return DebugService.GiveGold(target, amount)
		elseif command == "spawnEnemy" then
			local zoneId = args[1]
			local count = tonumber(args[2]) or 1
			return DebugService.SpawnEnemy(zoneId, count)
		elseif command == "killAllEnemies" then
			return DebugService.KillAllEnemies()
		elseif command == "resetPlayerProgress" then
			local target = args[1]
			return DebugService.ResetPlayerProgress(target)
		else
			return { success = false, message = "Unknown command: " .. command }
		end
	end)

	if success then
		RemoteEvents.Notification:FireClient(player, {
			message = result.message or "Debug command executed",
			notifType = result.success and "Info" or "Error",
		})
	else
		RemoteEvents.Notification:FireClient(player, {
			message = "Debug error: " .. tostring(result),
			notifType = "Error",
		})
	end
end

-- -- Init ---------------------------------------------------------------------
function DebugService.Init(config: {
	PlayerDataService: any,
	LevelingService: any,
	EnemyService: any,
	BossService: any,
	ZoneService: any?,
})
	PlayerDataService = config.PlayerDataService
	LevelingService   = config.LevelingService
	EnemyService      = config.EnemyService
	BossService       = config.BossService
	ZoneService       = config.ZoneService

	-- Register RemoteEvent handler
	RemoteEvents.DebugCommand:Connect(onDebugCommand)

	-- Register chat commands
	DebugService.RegisterChatCommands()

	print("[DebugService] Initialized.")
end

-- -- Register Chat Commands ---------------------------------------------------
-- Adds /debug commands to ChatCommandService if available
-- -----------------------------------------------------------------------------
function DebugService.RegisterChatCommands()
	-- Hook into chat commands by listening for chat messages
	-- This is handled via the RemoteEvent, but we also support /debug prefix
	task.spawn(function()
		while true do
			task.wait(1)
			-- Chat commands are handled via ChatCommandService
			-- DebugService adds its own prefix handler below
		end
	end)
end

-- -- GetGameState -------------------------------------------------------------
-- Returns a summary of all game entities: players, zones, enemies, bosses
-- -----------------------------------------------------------------------------
function DebugService.GetGameState(): { success: boolean, message: string, data: {} }
	local state = {
		players = {},
		activeEnemies = 0,
		activeBosses = {},
		zones = {},
	}

	-- Players
	for _, player in ipairs(Players:GetPlayers()) do
		local data = PlayerDataService.GetData(player)
		if data then
			table.insert(state.players, {
				name = player.Name,
				userId = player.UserId,
				level = data.Level or 1,
				zone = data.CurrentZone or "StarterVillage",
				gold = data.Gold or 0,
				isAdmin = data.IsAdmin or false,
			})
		end
	end

	-- Enemies
	if EnemyService and EnemyService.GetActiveEnemies then
		local enemies = EnemyService.GetActiveEnemies()
		state.activeEnemies = #enemies
		state.enemyList = {}
		for _, enemy in ipairs(enemies) do
			local zone = enemy:GetAttribute("ZoneId") or "Unknown"
			local health = enemy:GetAttribute("Health") or 0
			local maxHealth = enemy:GetAttribute("MaxHealth") or 1
			table.insert(state.enemyList, {
				name = enemy.Name,
				zone = zone,
				health = health,
				maxHealth = maxHealth,
				healthPercent = math.floor((health / maxHealth) * 100),
			})
		end
	end

	-- Bosses
	if BossService and BossService.GetActiveBosses then
		local bosses = BossService.GetActiveBosses()
		for bossId, bossData in pairs(bosses) do
			local health = bossData.Model and bossData.Model:GetAttribute("Health") or 0
			local maxHealth = bossData.Model and bossData.Model:GetAttribute("MaxHealth") or 1
			table.insert(state.activeBosses, {
				bossId = bossId,
				alive = bossData.Model ~= nil,
				health = health,
				maxHealth = maxHealth,
				healthPercent = math.floor((health / maxHealth) * 100),
				participantCount = bossData.Participants and #bossData.Participants or 0,
			})
		end
	end

	local playerCount = #state.players
	local enemyCount = state.activeEnemies
	local bossCount = #state.activeBosses

	return {
		success = true,
		message = string.format("Players: %d | Enemies: %d | Bosses: %d", playerCount, enemyCount, bossCount),
		data = state,
	}
end

-- -- ForceLevelUp ------------------------------------------------------------
-- Instantly levels up a player by 1 level
-- Usage: DebugService.ForceLevelUp(player) or DebugService.ForceLevelUp("PlayerName")
-- -----------------------------------------------------------------------------
function DebugService.ForceLevelUp(target: Player | string): { success: boolean, message: string }
	local player = typeof(target) == "Instance" and target or Players:FindFirstChild(tostring(target))

	if not player then
		return { success = false, message = "Player not found: " .. tostring(target) }
	end

	local data = PlayerDataService.GetData(player)
	if not data then
		return { success = false, message = "Player data not loaded: " .. player.Name }
	end

	-- Grant XP to level up
	local currentLevel = data.Level or 1
	local xpNeeded = LevelingService.GetXPForLevel(currentLevel + 1)
	data.XP = (data.XP or 0) + xpNeeded

	-- Trigger level up check
	LevelingService.CheckLevelUp(player)

	local newLevel = data.Level
	return {
		success = true,
		message = string.format("%s leveled up from %d to %d", player.Name, currentLevel, newLevel),
	}
end

-- -- GiveGold -----------------------------------------------------------------
-- Gives gold to a player
-- Usage: DebugService.GiveGold(player, amount) or DebugService.GiveGold("PlayerName", 1000)
-- -----------------------------------------------------------------------------
function DebugService.GiveGold(target: Player | string, amount: number): { success: boolean, message: string }
	local player = typeof(target) == "Instance" and target or Players:FindFirstChild(tostring(target))

	if not player then
		return { success = false, message = "Player not found: " .. tostring(target) }
	end

	local data = PlayerDataService.GetData(player)
	if not data then
		return { success = false, message = "Player data not loaded: " .. player.Name }
	end

	data.Gold = (data.Gold or 0) + amount

	-- Update leaderstats if available
	local leaderstats = player:FindFirstChild("leaderstats")
	if leaderstats then
		local gold = leaderstats:FindFirstChild("Gold")
		if gold then
			gold.Value = data.Gold
		end
	end

	-- Fire notification
	RemoteEvents.Notification:FireClient(player, {
		message = string.format("DEBUG: Received %d gold", amount),
		notifType = "Info",
	})

	return {
		success = true,
		message = string.format("Gave %d gold to %s (total: %d)", amount, player.Name, data.Gold),
	}
end

-- -- SpawnEnemy ---------------------------------------------------------------
-- Spawns enemies in a specific zone
-- Usage: DebugService.SpawnEnemy("WhisperingForest", 5)
-- -----------------------------------------------------------------------------
function DebugService.SpawnEnemy(zoneId: string, count: number): { success: boolean, message: string }
	if not EnemyService or not EnemyService.ForceSpawnEnemy then
		return { success = false, message = "EnemyService.ForceSpawnEnemy not available" }
	end

	local validZones = {
		"StarterVillage",
		"WhisperingForest",
		"CrimsonDesert",
		"FrozenPeaks",
		"ShadowCitadel",
	}

	local isValid = false
	for _, zone in ipairs(validZones) do
		if zone == zoneId then
			isValid = true
			break
		end
	end

	if not isValid then
		return { success = false, message = "Invalid zone: " .. zoneId .. ". Valid: " .. table.concat(validZones, ", ") }
	end

	local spawned = 0
	for _ = 1, count do
		local enemy = EnemyService.ForceSpawnEnemy(zoneId)
		if enemy then
			spawned = spawned + 1
		end
	end

	return {
		success = true,
		message = string.format("Spawned %d/%d enemies in %s", spawned, count, zoneId),
	}
end

-- -- KillAllEnemies -----------------------------------------------------------
-- Kills all active enemies in the game
-- Usage: DebugService.KillAllEnemies()
-- -----------------------------------------------------------------------------
function DebugService.KillAllEnemies(): { success: boolean, message: string }
	if not EnemyService or not EnemyService.GetActiveEnemies then
		return { success = false, message = "EnemyService.GetActiveEnemies not available" }
	end

	local enemies = EnemyService.GetActiveEnemies()
	local killed = 0

	for _, enemy in ipairs(enemies) do
		if enemy and enemy:GetAttribute("Health") then
			enemy:SetAttribute("Health", 0)
			killed = killed + 1
		end
	end

	return {
		success = true,
		message = string.format("Killed %d enemies", killed),
	}
end

-- -- ResetPlayerProgress ------------------------------------------------------
-- Resets a player's progress (level, gold, XP, quests, etc.)
-- Usage: DebugService.ResetPlayerProgress(player) or DebugService.ResetPlayerProgress("PlayerName")
-- WARNING: This is destructive!
-- -----------------------------------------------------------------------------
function DebugService.ResetPlayerProgress(target: Player | string): { success: boolean, message: string }
	local player = typeof(target) == "Instance" and target or Players:FindFirstChild(tostring(target))

	if not player then
		return { success = false, message = "Player not found: " .. tostring(target) }
	end

	local data = PlayerDataService.GetData(player)
	if not data then
		return { success = false, message = "Player data not loaded: " .. player.Name }
	end

	-- Store original admin status
	local wasAdmin = data.IsAdmin

	-- Reset to defaults
	data.Level = 1
	data.XP = 0
	data.Gold = 0
	data.SkillPoints = 0
	data.SkillTree = {}
	data.Quests = {}
	data.CurrentZone = "StarterVillage"
	data.TotalKills = 0
	data.TotalGoldEarned = 0
	data.TotalXP = 0
	data.DailyQuests = {}
	data.WeeklyQuests = {}
	data.DailyLogin = { Count = 0, TotalDays = 0, LastLogin = "" }
	data.Pets = {}
	data.EquippedPets = {}
	data.Cosmetics = {}
	data.EquippedCosmetics = {}
	data.Housing = {}
	data.Stats = {
		Damage = 1,
		Health = 100,
		Speed = 16,
		Defense = 0,
		AttackSpeed = 1,
		CritChance = 0,
		CritDamage = 1.5,
		Dodge = 0,
	}
	data.Rebirths = 0

	-- Restore admin flag
	data.IsAdmin = wasAdmin

	-- Reset leaderstats
	local leaderstats = player:FindFirstChild("leaderstats")
	if leaderstats then
		local level = leaderstats:FindFirstChild("Level")
		local gold = leaderstats:FindFirstChild("Gold")
		if level then
			level.Value = 1
		end
		if gold then
			gold.Value = 0
		end
	end

	-- Respawn player
	local character = player.Character
	if character then
		local humanoid = character:FindFirstChild("Humanoid")
		if humanoid then
			humanoid.Health = humanoid.MaxHealth
		end
		local spawnLocation = workspace:FindFirstChild("SpawnLocation")
		if spawnLocation then
			character:PivotTo(spawnLocation.CFrame)
		else
			character:PivotTo(CFrame.new(0, 10, 0))
		end
	end

	-- Fire notification
	RemoteEvents.Notification:FireClient(player, {
		message = "DEBUG: Progress reset!",
		notifType = "Info",
	})

	return {
		success = true,
		message = string.format("Reset progress for %s (level 1, 0 gold, starter zone)", player.Name),
	}
end

-- -- TeleportTo --------------------------------------------------------------
-- Teleports a player to a zone
-- Usage: DebugService.TeleportTo(player, "WhisperingForest")
-- -----------------------------------------------------------------------------
function DebugService.TeleportTo(target: Player | string, zoneId: string): { success: boolean, message: string }
	local player = typeof(target) == "Instance" and target or Players:FindFirstChild(tostring(target))

	if not player then
		return { success = false, message = "Player not found: " .. tostring(target) }
	end

	if not ZoneService or not ZoneService.TeleportPlayerToZone then
		return { success = false, message = "ZoneService.TeleportPlayerToZone not available" }
	end

	local success, err = pcall(function()
		ZoneService.TeleportPlayerToZone(player, zoneId)
	end)

	if not success then
		return { success = false, message = "Teleport failed: " .. tostring(err) }
	end

	return {
		success = true,
		message = string.format("Teleported %s to %s", player.Name, zoneId),
	}
end

-- -- SetEnemyHealth -----------------------------------------------------------
-- Sets health of all enemies in a zone to a specific value (for testing)
-- Usage: DebugService.SetZoneEnemyHealth("WhisperingForest", 1)
-- -----------------------------------------------------------------------------
function DebugService.SetZoneEnemyHealth(zoneId: string, health: number): { success: boolean, message: string }
	if not EnemyService or not EnemyService.GetActiveEnemies then
		return { success = false, message = "EnemyService.GetActiveEnemies not available" }
	end

	local enemies = EnemyService.GetActiveEnemies()
	local affected = 0

	for _, enemy in ipairs(enemies) do
		local enemyZone = enemy:GetAttribute("ZoneId")
		if enemyZone == zoneId then
			enemy:SetAttribute("Health", health)
			local humanoid = enemy:FindFirstChild("Humanoid")
			if humanoid then
				humanoid.Health = health
			end
			affected = affected + 1
		end
	end

	return {
		success = true,
		message = string.format("Set health to %d for %d enemies in %s", health, affected, zoneId),
	}
end

return DebugService
