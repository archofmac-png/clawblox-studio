-- HUDController.luau
-- Manages the main HUD ScreenGui, built entirely in Luau (no external assets).
-- ModuleScript in StarterPlayerScripts.

local Players        = game:GetService("Players")
local TweenService   = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local LocalPlayer = Players.LocalPlayer
local PlayerGui   = LocalPlayer:WaitForChild("PlayerGui")

local RemoteEvents = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Remotes"):WaitForChild("RemoteEvents"))

-- -- Internal state ------------------------------------------------------------
local HUDController = {}

local gui             -- ScreenGui
local healthFill      -- Frame (red fill)
local healthLabel     -- TextLabel
local xpFill          -- Frame (blue fill)
local xpLabel         -- TextLabel
local levelLabel      -- TextLabel
local goldLabel       -- TextLabel
local skillPtsBadge   -- Frame
local skillPtsLabel   -- TextLabel
local zoneLabel       -- TextLabel
local statsPanel      -- Frame (Tab toggle)
local statsPanelOpen  = false

local currentHealth   = 100
local maxHealth       = 100
local currentXP       = 0
local maxXP           = 100
local currentLevel    = 1
local currentGold     = 0
local currentSkillPts = 0
local currentSkills   = {}
local currentStats    = {}

-- -- Utility helpers -----------------------------------------------------------
local function makeFrame(parent, name, bg, size, pos, anchor)
	local f = Instance.new("Frame")
	f.Name            = name
	f.BackgroundColor3 = bg or Color3.fromRGB(30, 30, 30)
	f.BorderSizePixel = 0
	f.Size            = size or UDim2.new(0,100,0,20)
	f.Position        = pos  or UDim2.new(0,0,0,0)
	f.AnchorPoint     = anchor or Vector2.new(0,0)
	f.Parent          = parent
	return f
end

local function makeLabel(parent, name, text, textColor, fontSize, anchor, size, pos)
	local l = Instance.new("TextLabel")
	l.Name            = name
	l.Text            = text or ""
	l.TextColor3      = textColor or Color3.fromRGB(255,255,255)
	l.BackgroundTransparency = 1
	l.Font            = Enum.Font.GothamBold
	l.TextSize        = fontSize or 14
	l.AnchorPoint     = anchor  or Vector2.new(0,0)
	l.Size            = size    or UDim2.new(1,0,1,0)
	l.Position        = pos     or UDim2.new(0,0,0,0)
	l.TextXAlignment  = Enum.TextXAlignment.Left
	l.Parent          = parent
	return l
end

local function addCorner(parent, radius)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius or 6)
	c.Parent = parent
end

local function addStroke(parent, color, thickness)
	local s = Instance.new("UIStroke")
	s.Color     = color or Color3.fromRGB(255,255,255)
	s.Thickness = thickness or 1
	s.Parent    = parent
end

local function formatNumber(n)
	-- Insert commas: 1250 → "1,250"
	local s = tostring(math.floor(n))
	local result = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	-- trim leading comma
	return result:gsub("^,", "")
end

-- -- Build Health Bar ----------------------------------------------------------
local function buildHealthBar(parent)
	local container = makeFrame(parent, "HealthBarContainer",
		Color3.fromRGB(20, 20, 20),
		UDim2.new(0, 240, 0, 28),
		UDim2.new(0, 10, 1, -50),
		Vector2.new(0, 1))
	addCorner(container, 6)
	addStroke(container, Color3.fromRGB(200,200,200), 1)

	local bg = makeFrame(container, "HealthBG",
		Color3.fromRGB(60, 0, 0),
		UDim2.new(1, -4, 1, -4),
		UDim2.new(0, 2, 0, 2))
	addCorner(bg, 4)

	healthFill = makeFrame(bg, "HealthFill",
		Color3.fromRGB(220, 40, 40),
		UDim2.new(1, 0, 1, 0),
		UDim2.new(0, 0, 0, 0))
	addCorner(healthFill, 4)

	healthLabel = makeLabel(container, "HealthLabel", "HP: 100/100",
		Color3.fromRGB(255,255,255), 12,
		Vector2.new(0,0), UDim2.new(1,0,1,0), UDim2.new(0,6,0,0))
	healthLabel.TextXAlignment = Enum.TextXAlignment.Left
	healthLabel.ZIndex = 3
end

-- -- Build XP Bar --------------------------------------------------------------
local function buildXPBar(parent)
	local container = makeFrame(parent, "XPBarContainer",
		Color3.fromRGB(20, 20, 20),
		UDim2.new(0, 240, 0, 22),
		UDim2.new(0, 10, 1, -82),
		Vector2.new(0, 1))
	addCorner(container, 6)
	addStroke(container, Color3.fromRGB(80,140,200), 1)

	local bg = makeFrame(container, "XPBG",
		Color3.fromRGB(0, 30, 60),
		UDim2.new(1, -4, 1, -4),
		UDim2.new(0, 2, 0, 2))
	addCorner(bg, 4)

	xpFill = makeFrame(bg, "XPFill",
		Color3.fromRGB(40, 160, 220),
		UDim2.new(0, 0, 1, 0),
		UDim2.new(0, 0, 0, 0))
	addCorner(xpFill, 4)

	xpLabel = makeLabel(container, "XPLabel", "XP: 0/100",
		Color3.fromRGB(180,230,255), 11,
		Vector2.new(0,0), UDim2.new(1,0,1,0), UDim2.new(0,6,0,0))
	xpLabel.ZIndex = 3
end

-- -- Build Level Badge ---------------------------------------------------------
local function buildLevelBadge(parent)
	local badge = makeFrame(parent, "LevelBadge",
		Color3.fromRGB(25, 25, 35),
		UDim2.new(0, 90, 0, 26),
		UDim2.new(0, 10, 1, -112),
		Vector2.new(0, 1))
	addCorner(badge, 6)
	addStroke(badge, Color3.fromRGB(120, 100, 200), 1)

	levelLabel = makeLabel(badge, "LevelLabel", "Lv. 1",
		Color3.fromRGB(255,255,255), 14,
		Vector2.new(0,0), UDim2.new(1,0,1,0), UDim2.new(0,0,0,0))
	levelLabel.TextXAlignment = Enum.TextXAlignment.Center
end

-- -- Build Gold Display --------------------------------------------------------
local function buildGoldDisplay(parent)
	local container = makeFrame(parent, "GoldDisplay",
		Color3.fromRGB(25, 25, 20),
		UDim2.new(0, 160, 0, 32),
		UDim2.new(1, -170, 0, 10),
		Vector2.new(0, 0))
	addCorner(container, 8)
	addStroke(container, Color3.fromRGB(200, 170, 40), 1)

	goldLabel = makeLabel(container, "GoldLabel", "💰 0G",
		Color3.fromRGB(255, 220, 60), 15,
		Vector2.new(0,0), UDim2.new(1,-8,1,0), UDim2.new(0,8,0,0))
	goldLabel.TextXAlignment = Enum.TextXAlignment.Left
end

-- -- Build Skill Points Badge --------------------------------------------------
local function buildSkillPointsBadge(parent)
	skillPtsBadge = makeFrame(parent, "SkillPointsBadge",
		Color3.fromRGB(50, 45, 10),
		UDim2.new(0, 180, 0, 32),
		UDim2.new(0, 10, 0, 10),
		Vector2.new(0, 0))
	addCorner(skillPtsBadge, 8)
	addStroke(skillPtsBadge, Color3.fromRGB(255, 215, 0), 2)
	skillPtsBadge.Visible = false

	skillPtsLabel = makeLabel(skillPtsBadge, "SkillPtsLabel", "⭐ 0 Skill Points",
		Color3.fromRGB(255, 240, 80), 14,
		Vector2.new(0,0), UDim2.new(1,-8,1,0), UDim2.new(0,8,0,0))
	skillPtsLabel.TextXAlignment = Enum.TextXAlignment.Left

	-- Pulse animation loop
	task.spawn(function()
		while true do
			if skillPtsBadge.Visible then
				TweenService:Create(skillPtsBadge, TweenInfo.new(0.8, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut), {
					BackgroundColor3 = Color3.fromRGB(80, 70, 10)
				}):Play()
				task.wait(0.8)
				TweenService:Create(skillPtsBadge, TweenInfo.new(0.8, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut), {
					BackgroundColor3 = Color3.fromRGB(50, 45, 10)
				}):Play()
				task.wait(0.8)
			else
				task.wait(0.5)
			end
		end
	end)
end

-- -- Build Zone Label ----------------------------------------------------------
local function buildZoneLabel(parent)
	local container = makeFrame(parent, "ZoneLabelContainer",
		Color3.fromRGB(0, 0, 0),
		UDim2.new(0, 280, 0, 36),
		UDim2.new(0.5, -140, 0, 10),
		Vector2.new(0, 0))
	addCorner(container, 8)
	container.BackgroundTransparency = 0.4

	zoneLabel = makeLabel(container, "ZoneLabel", "",
		Color3.fromRGB(255, 255, 200), 16,
		Vector2.new(0,0), UDim2.new(1,0,1,0), UDim2.new(0,0,0,0))
	zoneLabel.TextXAlignment = Enum.TextXAlignment.Center
	zoneLabel.BackgroundTransparency = 1

	-- Start invisible
	container.BackgroundTransparency = 1
	zoneLabel.TextTransparency = 1

	-- Store ref to container for fade
	zoneLabel:SetAttribute("ContainerRef", container.Name)
	gui:SetAttribute("ZoneContainer", container.Name)
end

-- -- Build Stats Panel ---------------------------------------------------------
local function buildStatsPanel(parent)
	statsPanel = makeFrame(parent, "StatsPanel",
		Color3.fromRGB(18, 18, 28),
		UDim2.new(0, 300, 0, 420),
		UDim2.new(0.5, -150, 0.5, -210),
		Vector2.new(0, 0))
	addCorner(statsPanel, 10)
	addStroke(statsPanel, Color3.fromRGB(80, 80, 120), 2)
	statsPanel.Visible = false
	statsPanel.ZIndex  = 10

	-- Title
	local title = makeLabel(statsPanel, "Title", "📊  Character Stats",
		Color3.fromRGB(200,200,255), 18,
		Vector2.new(0,0), UDim2.new(1,0,0,36), UDim2.new(0,0,0,0))
	title.TextXAlignment = Enum.TextXAlignment.Center
	title.ZIndex = 11

	-- Divider
	local divider = makeFrame(statsPanel, "Divider",
		Color3.fromRGB(80,80,120),
		UDim2.new(1,-20,0,1),
		UDim2.new(0,10,0,38))
	divider.ZIndex = 11

	-- Scrollable list
	local scroll = Instance.new("ScrollingFrame")
	scroll.Name                = "StatsScroll"
	scroll.Size                = UDim2.new(1,-10,1,-50)
	scroll.Position            = UDim2.new(0,5,0,44)
	scroll.BackgroundTransparency = 1
	scroll.ScrollBarThickness  = 4
	scroll.ScrollBarImageColor3 = Color3.fromRGB(100,100,160)
	scroll.BorderSizePixel     = 0
	scroll.ZIndex              = 11
	scroll.Parent              = statsPanel

	local layout = Instance.new("UIListLayout")
	layout.SortOrder   = Enum.SortOrder.LayoutOrder
	layout.Padding     = UDim.new(0, 4)
	layout.Parent      = scroll

	local padding = Instance.new("UIPadding")
	padding.PaddingLeft   = UDim.new(0,8)
	padding.PaddingRight  = UDim.new(0,8)
	padding.PaddingTop    = UDim.new(0,4)
	padding.Parent        = scroll

	statsPanel:SetAttribute("ScrollName", "StatsScroll")
end

-- -- Populate Stats Panel ------------------------------------------------------
local function refreshStatsPanel()
	local scroll = statsPanel:FindFirstChild("StatsScroll")
	if not scroll then return end

	-- Clear existing rows
	for _, child in ipairs(scroll:GetChildren()) do
		if child:IsA("Frame") or child:IsA("TextLabel") then
			child:Destroy()
		end
	end

	local rowIndex = 0
	local function addRow(labelText, value, color)
		rowIndex += 1
		local row = makeFrame(scroll, "Row"..rowIndex,
			rowIndex % 2 == 0 and Color3.fromRGB(28,28,40) or Color3.fromRGB(22,22,32),
			UDim2.new(1,0,0,28),
			UDim2.new(0,0,0,0))
		row.LayoutOrder = rowIndex
		row.ZIndex = 12

		local lbl = makeLabel(row, "Key", labelText,
			color or Color3.fromRGB(180,180,220), 13,
			Vector2.new(0,0.5), UDim2.new(0.6,0,1,0), UDim2.new(0,4,0.5,0))
		lbl.TextXAlignment = Enum.TextXAlignment.Left
		lbl.ZIndex = 13

		local val = makeLabel(row, "Val", tostring(value),
			Color3.fromRGB(255,255,255), 13,
			Vector2.new(1,0.5), UDim2.new(0.38,0,1,0), UDim2.new(1,-4,0.5,0))
		val.TextXAlignment = Enum.TextXAlignment.Right
		val.ZIndex = 13
	end

	-- Core stats
	addRow("Level",     currentLevel,           Color3.fromRGB(200,200,255))
	addRow("XP",        currentXP.."/"..maxXP,  Color3.fromRGB(80,200,255))
	addRow("Gold",      formatNumber(currentGold), Color3.fromRGB(255,220,60))
	addRow("Damage",    currentStats.Damage    or 0, Color3.fromRGB(255,120,80))
	addRow("Defense",   currentStats.Defense   or 0, Color3.fromRGB(80,180,255))
	addRow("Max HP",    currentStats.MaxHealth  or 0, Color3.fromRGB(220,80,80))
	addRow("MoveSpeed", currentStats.MoveSpeed  or 0, Color3.fromRGB(120,255,120))

	-- Divider
	rowIndex += 1
	local div = makeFrame(scroll, "SkillDivider",
		Color3.fromRGB(80,80,120),
		UDim2.new(1,0,0,1),
		UDim2.new(0,0,0,0))
	div.LayoutOrder = rowIndex
	div.ZIndex = 12

	-- Skill header
	rowIndex += 1
	local sh = makeLabel(scroll, "SkillHeader", "-- Skills --",
		Color3.fromRGB(160,120,255), 13,
		Vector2.new(0,0), UDim2.new(1,0,0,24), UDim2.new(0,0,0,0))
	sh.LayoutOrder = rowIndex
	sh.TextXAlignment = Enum.TextXAlignment.Center
	sh.ZIndex = 12

	-- Skill rows (with + button if skill points available)
	local skillNames = {"Strength","Agility","Intelligence","Vitality","Luck"}
	for _, skillName in ipairs(skillNames) do
		rowIndex += 1
		local rank = currentSkills[skillName] or 0

		local row = makeFrame(scroll, "Skill_"..skillName,
			rowIndex % 2 == 0 and Color3.fromRGB(28,28,40) or Color3.fromRGB(22,22,32),
			UDim2.new(1,0,0,28),
			UDim2.new(0,0,0,0))
		row.LayoutOrder = rowIndex
		row.ZIndex = 12

		local lbl = makeLabel(row, "SkillName", skillName,
			Color3.fromRGB(200,160,255), 13,
			Vector2.new(0,0.5), UDim2.new(0.55,0,1,0), UDim2.new(0,4,0.5,0))
		lbl.TextXAlignment = Enum.TextXAlignment.Left
		lbl.ZIndex = 13

		local rankLbl = makeLabel(row, "Rank", "Rank "..rank,
			Color3.fromRGB(255,255,255), 13,
			Vector2.new(1,0.5), UDim2.new(0.28,0,1,0), UDim2.new(1, currentSkillPts > 0 and -42 or -4, 0.5, 0))
		rankLbl.TextXAlignment = Enum.TextXAlignment.Right
		rankLbl.ZIndex = 13

		if currentSkillPts > 0 then
			local btn = Instance.new("TextButton")
			btn.Name             = "AllocBtn"
			btn.Text             = "[+]"
			btn.TextColor3       = Color3.fromRGB(80,255,80)
			btn.BackgroundColor3 = Color3.fromRGB(20,50,20)
			btn.Font             = Enum.Font.GothamBold
			btn.TextSize         = 13
			btn.Size             = UDim2.new(0,34,0,22)
			btn.Position         = UDim2.new(1,-36,0.5,-11)
			btn.AnchorPoint      = Vector2.new(0,0)
			btn.BorderSizePixel  = 0
			btn.ZIndex           = 14
			btn.Parent           = row
			addCorner(btn, 4)

			local capturedSkill = skillName
			btn.MouseButton1Click:Connect(function()
				local remotes = RemoteEvents.Get()
				if remotes and remotes.AllocateSkillPoint then
					remotes.AllocateSkillPoint:FireServer({ skillName = capturedSkill })
				end
			end)
		end
	end

	-- Update canvas size
	local layout = scroll:FindFirstChildOfClass("UIListLayout")
	if layout then
		scroll.CanvasSize = UDim2.new(0,0,0, layout.AbsoluteContentSize.Y + 10)
	end
end

-- -- Zone fade helper ----------------------------------------------------------
local function showZone(zoneName)
	local container = gui:FindFirstChild("ZoneLabelContainer")
	if not container then return end
	local lbl = container:FindFirstChild("ZoneLabel")
	if not lbl then return end

	lbl.Text = "📍 " .. zoneName

	-- Fade in
	container.BackgroundTransparency = 0.4
	lbl.TextTransparency             = 0
	TweenService:Create(container, TweenInfo.new(0.5), {BackgroundTransparency = 0.4}):Play()
	TweenService:Create(lbl,       TweenInfo.new(0.5), {TextTransparency = 0}):Play()

	-- Hold 3 seconds then fade out
	task.delay(3, function()
		TweenService:Create(container, TweenInfo.new(1.0), {BackgroundTransparency = 1}):Play()
		TweenService:Create(lbl,       TweenInfo.new(1.0), {TextTransparency = 1}):Play()
	end)
end

-- -- Public: Init -------------------------------------------------------------
function HUDController.Init()
	-- Remove existing gui if reinitialising
	local existing = PlayerGui:FindFirstChild("MainHUD")
	if existing then existing:Destroy() end

	gui = Instance.new("ScreenGui")
	gui.Name              = "MainHUD"
	gui.ResetOnSpawn      = false
	gui.IgnoreGuiInset    = false
	gui.ZIndexBehavior    = Enum.ZIndexBehavior.Sibling
	gui.Parent            = PlayerGui

	buildHealthBar(gui)
	buildXPBar(gui)
	buildLevelBadge(gui)
	buildGoldDisplay(gui)
	buildSkillPointsBadge(gui)
	buildZoneLabel(gui)
	buildStatsPanel(gui)

	-- Tab toggle for stats panel
	UserInputService.InputBegan:Connect(function(input, processed)
		if processed then return end
		if input.KeyCode == Enum.KeyCode.Tab then
			statsPanelOpen = not statsPanelOpen
			if statsPanelOpen then
				refreshStatsPanel()
			end
			statsPanel.Visible = statsPanelOpen
		end
	end)

	-- Listen to remotes
	local remotes = RemoteEvents.Get()

	if remotes.StatsUpdated then
		remotes.StatsUpdated.OnClientEvent:Connect(function(data)
			HUDController.UpdateAll(data)
		end)
	end

	if remotes.LevelUp then
		remotes.LevelUp.OnClientEvent:Connect(function(data)
			if data and data.NewLevel then
				currentLevel = data.NewLevel
				levelLabel.Text = "Lv. " .. currentLevel
				if data.SkillPointsTotal then
					HUDController.ShowSkillPoints(data.SkillPointsTotal)
				end
				if statsPanelOpen then refreshStatsPanel() end
			end
		end)
	end

	if remotes.SkillPointsUpdated then
		remotes.SkillPointsUpdated.OnClientEvent:Connect(function(data)
			if data then
				if data.SkillPoints ~= nil then
					HUDController.ShowSkillPoints(data.SkillPoints)
				end
				if data.Skills then
					currentSkills = data.Skills
				end
				if statsPanelOpen then refreshStatsPanel() end
			end
		end)
	end

	if remotes.ZoneEntryGranted then
		remotes.ZoneEntryGranted.OnClientEvent:Connect(function(data)
			if data and data.ZoneName then
				showZone(data.ZoneName)
			end
		end)
	end

	print("[HUDController] Initialized.")
end

-- -- Public: UpdateAll ---------------------------------------------------------
function HUDController.UpdateAll(data)
	if not data then return end

	if data.Stats then
		currentStats = data.Stats
		local maxHP = data.Stats.MaxHealth or maxHealth
		HUDController.UpdateHealth(currentHealth, maxHP)
	end

	if data.Level then
		currentLevel = data.Level
		levelLabel.Text = "Lv. " .. currentLevel
	end

	local xpMax = 0
	if data.Stats and data.Stats.MaxHealth then
		-- XP cap is not in Stats; handled below
	end

	if data.XP ~= nil then
		-- We need maxXP — if not provided, keep current; server should send it
		-- Attempt to read from data.XPToNextLevel or data.MaxXP
		local cap = data.XPToNextLevel or data.MaxXP or maxXP
		HUDController.UpdateXP(data.XP, cap, data.Level or currentLevel)
	end

	if data.Gold ~= nil then
		HUDController.UpdateGold(data.Gold)
	end

	if data.SkillPoints ~= nil then
		HUDController.ShowSkillPoints(data.SkillPoints)
	end

	if data.Skills then
		currentSkills = data.Skills
	end

	if data.CurrentZone then
		showZone(data.CurrentZone)
	end

	if statsPanelOpen then refreshStatsPanel() end
end

-- -- Public: UpdateHealth ------------------------------------------------------
function HUDController.UpdateHealth(current, max)
	currentHealth = current or currentHealth
	maxHealth     = max     or maxHealth

	healthLabel.Text = "HP: " .. math.floor(currentHealth) .. "/" .. math.floor(maxHealth)

	local ratio = math.clamp(currentHealth / math.max(maxHealth, 1), 0, 1)
	TweenService:Create(healthFill, TweenInfo.new(0.3, Enum.EasingStyle.Quad), {
		Size = UDim2.new(ratio, 0, 1, 0)
	}):Play()
end

-- -- Public: UpdateXP ---------------------------------------------------------
function HUDController.UpdateXP(current, max, level)
	currentXP    = current or currentXP
	maxXP        = max     or maxXP
	if level then
		currentLevel = level
		levelLabel.Text = "Lv. " .. currentLevel
	end

	xpLabel.Text = "XP: " .. math.floor(currentXP) .. "/" .. math.floor(maxXP)

	local ratio = math.clamp(currentXP / math.max(maxXP, 1), 0, 1)
	TweenService:Create(xpFill, TweenInfo.new(0.4, Enum.EasingStyle.Quad), {
		Size = UDim2.new(ratio, 0, 1, 0)
	}):Play()
end

-- -- Public: UpdateGold -------------------------------------------------------
function HUDController.UpdateGold(amount)
	currentGold    = amount or 0
	goldLabel.Text = "💰 " .. formatNumber(currentGold) .. "G"
end

-- -- Public: ShowSkillPoints --------------------------------------------------
function HUDController.ShowSkillPoints(amount)
	currentSkillPts         = amount or 0
	skillPtsBadge.Visible   = currentSkillPts > 0
	skillPtsLabel.Text      = "⭐ " .. currentSkillPts .. " Skill Point" .. (currentSkillPts == 1 and "" or "s")
end

return HUDController
