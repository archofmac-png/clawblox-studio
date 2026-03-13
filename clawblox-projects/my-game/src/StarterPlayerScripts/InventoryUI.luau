-- InventoryUI.luau
-- Full-screen inventory panel with item grid, equip/unequip/sell actions.
-- Toggle with I or B key. Listens to InventoryUpdated remote.
-- ModuleScript in StarterPlayerScripts.

local Players          = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local TweenService     = game:GetService("TweenService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local LocalPlayer = Players.LocalPlayer
local PlayerGui   = LocalPlayer:WaitForChild("PlayerGui")

local RemoteEvents = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Remotes"):WaitForChild("RemoteEvents"))

local InventoryUI = {}

local gui         -- ScreenGui
local panel       -- main 600x500 frame
local scrollFrame
local isOpen = false

local cachedInventory = {}  -- { [itemId] = { Quantity = N, Equipped = bool } }

-- Item types that can be equipped
local EQUIPPABLE_KEYWORDS = {"Armor", "Robe", "Cloak", "Crown", "Bow", "Blade", "Staff", "Scythe"}

local function isEquippable(itemId)
	for _, kw in ipairs(EQUIPPABLE_KEYWORDS) do
		if itemId:find(kw) then return true end
	end
	return false
end

local function formatItemName(itemId)
	-- "WoodSpirit_Essence" → "WoodSpirit Essence"
	return itemId:gsub("_", " ")
end

local function addCorner(parent, radius)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius or 8)
	c.Parent = parent
end

local function addStroke(parent, color, thickness)
	local s = Instance.new("UIStroke")
	s.Color     = color or Color3.fromRGB(100, 100, 100)
	s.Thickness = thickness or 1
	s.Parent    = parent
end

local function makeButton(parent, text, bgColor, textColor, size, position)
	local btn = Instance.new("TextButton")
	btn.Text              = text
	btn.BackgroundColor3  = bgColor
	btn.TextColor3        = textColor or Color3.fromRGB(255, 255, 255)
	btn.Font              = Enum.Font.GothamBold
	btn.TextSize          = 12
	btn.BorderSizePixel   = 0
	btn.Size              = size or UDim2.new(0, 70, 0, 26)
	btn.Position          = position or UDim2.new(0, 0, 0, 0)
	btn.Parent            = parent
	addCorner(btn, 5)
	return btn
end

-- -- Build the UI shell (called once) -----------------------------------------
local function buildUI()
	local existing = PlayerGui:FindFirstChild("InventoryGUI")
	if existing then existing:Destroy() end

	gui = Instance.new("ScreenGui")
	gui.Name            = "InventoryGUI"
	gui.ResetOnSpawn    = false
	gui.IgnoreGuiInset  = false
	gui.ZIndexBehavior  = Enum.ZIndexBehavior.Sibling
	gui.Parent          = PlayerGui

	-- Dark backdrop
	local backdrop = Instance.new("Frame")
	backdrop.Name              = "Backdrop"
	backdrop.BackgroundColor3  = Color3.fromRGB(0, 0, 0)
	backdrop.BackgroundTransparency = 0.45
	backdrop.BorderSizePixel   = 0
	backdrop.Size              = UDim2.new(1, 0, 1, 0)
	backdrop.ZIndex            = 8
	backdrop.Visible           = false
	backdrop.Parent            = gui

	-- Main panel
	panel = Instance.new("Frame")
	panel.Name              = "InventoryPanel"
	panel.BackgroundColor3  = Color3.fromRGB(16, 16, 24)
	panel.BorderSizePixel   = 0
	panel.AnchorPoint       = Vector2.new(0.5, 0.5)
	panel.Position          = UDim2.new(0.5, 0, 0.5, 0)
	panel.Size              = UDim2.new(0, 620, 0, 520)
	panel.ZIndex            = 9
	panel.Visible           = false
	panel.Parent            = gui
	addCorner(panel, 12)
	addStroke(panel, Color3.fromRGB(80, 80, 140), 2)

	-- Title bar
	local titleBar = Instance.new("Frame")
	titleBar.BackgroundColor3 = Color3.fromRGB(24, 24, 40)
	titleBar.BorderSizePixel  = 0
	titleBar.Size             = UDim2.new(1, 0, 0, 46)
	titleBar.ZIndex           = 10
	titleBar.Parent           = panel
	addCorner(titleBar, 12)

	local titleLbl = Instance.new("TextLabel")
	titleLbl.Text            = "🎒  Inventory"
	titleLbl.TextColor3      = Color3.fromRGB(220, 220, 255)
	titleLbl.BackgroundTransparency = 1
	titleLbl.Font            = Enum.Font.GothamBold
	titleLbl.TextSize        = 20
	titleLbl.Size            = UDim2.new(1, -60, 1, 0)
	titleLbl.Position        = UDim2.new(0, 16, 0, 0)
	titleLbl.TextXAlignment  = Enum.TextXAlignment.Left
	titleLbl.ZIndex          = 11
	titleLbl.Parent          = titleBar

	-- Close button
	local closeBtn = Instance.new("TextButton")
	closeBtn.Text              = "✕"
	closeBtn.TextColor3        = Color3.fromRGB(200, 200, 200)
	closeBtn.BackgroundColor3  = Color3.fromRGB(60, 30, 30)
	closeBtn.Font              = Enum.Font.GothamBold
	closeBtn.TextSize          = 16
	closeBtn.BorderSizePixel   = 0
	closeBtn.Size              = UDim2.new(0, 34, 0, 34)
	closeBtn.AnchorPoint       = Vector2.new(1, 0.5)
	closeBtn.Position          = UDim2.new(1, -8, 0.5, 0)
	closeBtn.ZIndex            = 11
	closeBtn.Parent            = titleBar
	addCorner(closeBtn, 6)

	closeBtn.MouseButton1Click:Connect(function()
		InventoryUI.Close()
	end)

	-- Scrolling frame for items
	scrollFrame = Instance.new("ScrollingFrame")
	scrollFrame.Name                = "ItemGrid"
	scrollFrame.BackgroundTransparency = 1
	scrollFrame.BorderSizePixel     = 0
	scrollFrame.Size                = UDim2.new(1, -20, 1, -60)
	scrollFrame.Position            = UDim2.new(0, 10, 0, 52)
	scrollFrame.ScrollBarThickness  = 5
	scrollFrame.ScrollBarImageColor3 = Color3.fromRGB(100, 100, 160)
	scrollFrame.ZIndex              = 10
	scrollFrame.Parent              = panel

	local gridLayout = Instance.new("UIGridLayout")
	gridLayout.CellSize    = UDim2.new(0, 180, 0, 140)
	gridLayout.CellPadding = UDim2.new(0, 10, 0, 10)
	gridLayout.SortOrder   = Enum.SortOrder.LayoutOrder
	gridLayout.HorizontalAlignment = Enum.HorizontalAlignment.Left
	gridLayout.Parent      = scrollFrame

	local gridPadding = Instance.new("UIPadding")
	gridPadding.PaddingLeft   = UDim.new(0, 6)
	gridPadding.PaddingTop    = UDim.new(0, 6)
	gridPadding.Parent        = scrollFrame

	-- Store refs
	gui:SetAttribute("BackdropName", backdrop.Name)
	gui:SetAttribute("GridLayoutRef", "ItemGrid")
end

-- -- Populate item cards -------------------------------------------------------
local function refreshItems()
	if not scrollFrame then return end

	-- Clear old cards
	for _, child in ipairs(scrollFrame:GetChildren()) do
		if child:IsA("Frame") then child:Destroy() end
	end

	-- Check empty
	local count = 0
	for _ in pairs(cachedInventory) do count += 1 end

	if count == 0 then
		local empty = Instance.new("TextLabel")
		empty.Text            = "No items yet.\nDefeat bosses to earn drops!"
		empty.TextColor3      = Color3.fromRGB(150, 150, 180)
		empty.BackgroundTransparency = 1
		empty.Font            = Enum.Font.Gotham
		empty.TextSize        = 15
		empty.Size            = UDim2.new(1, -20, 0, 80)
		empty.Position        = UDim2.new(0, 10, 0, 30)
		empty.TextWrapped     = true
		empty.TextXAlignment  = Enum.TextXAlignment.Center
		empty.ZIndex          = 11
		empty.Parent          = scrollFrame
		scrollFrame.CanvasSize = UDim2.new(0, 0, 0, 120)
		return
	end

	local remotes = RemoteEvents.Get()
	local i = 0
	for itemId, itemData in pairs(cachedInventory) do
		i += 1
		local equipped = itemData.Equipped or false

		local card = Instance.new("Frame")
		card.Name             = "Card_" .. itemId
		card.BackgroundColor3 = Color3.fromRGB(22, 22, 34)
		card.BorderSizePixel  = 0
		card.LayoutOrder      = i
		card.ZIndex           = 11
		card.Parent           = scrollFrame
		addCorner(card, 8)

		-- Gold border if equipped
		if equipped then
			addStroke(card, Color3.fromRGB(255, 200, 30), 2)
		else
			addStroke(card, Color3.fromRGB(60, 60, 80), 1)
		end

		-- Item name
		local nameLbl = Instance.new("TextLabel")
		nameLbl.Text           = formatItemName(itemId)
		nameLbl.TextColor3     = equipped and Color3.fromRGB(255, 220, 80) or Color3.fromRGB(220, 220, 255)
		nameLbl.BackgroundTransparency = 1
		nameLbl.Font           = Enum.Font.GothamBold
		nameLbl.TextSize       = 13
		nameLbl.Size           = UDim2.new(1, -8, 0, 36)
		nameLbl.Position       = UDim2.new(0, 4, 0, 6)
		nameLbl.TextXAlignment = Enum.TextXAlignment.Left
		nameLbl.TextWrapped    = true
		nameLbl.ZIndex         = 12
		nameLbl.Parent         = card

		-- Quantity badge
		local qtyBadge = Instance.new("TextLabel")
		qtyBadge.Text          = "x" .. (itemData.Quantity or 1)
		qtyBadge.TextColor3    = Color3.fromRGB(160, 255, 160)
		qtyBadge.BackgroundColor3 = Color3.fromRGB(20, 50, 20)
		qtyBadge.BackgroundTransparency = 0
		qtyBadge.Font          = Enum.Font.Gotham
		qtyBadge.TextSize      = 12
		qtyBadge.Size          = UDim2.new(0, 40, 0, 22)
		qtyBadge.AnchorPoint   = Vector2.new(1, 0)
		qtyBadge.Position      = UDim2.new(1, -4, 0, 4)
		qtyBadge.TextXAlignment = Enum.TextXAlignment.Center
		qtyBadge.ZIndex        = 13
		qtyBadge.Parent        = card
		addCorner(qtyBadge, 5)

		-- Action buttons row
		local btnY = 90

		if isEquippable(itemId) then
			if equipped then
				local unequipBtn = makeButton(card, "Unequip",
					Color3.fromRGB(180, 100, 20), Color3.fromRGB(255, 255, 255),
					UDim2.new(0, 80, 0, 26), UDim2.new(0, 4, 0, btnY))
				unequipBtn.ZIndex = 13
				unequipBtn.MouseButton1Click:Connect(function()
					if remotes and remotes.RequestUnequipCosmetic then
						remotes.RequestUnequipCosmetic:FireServer({ itemId = itemId })
					end
				end)
			else
				local equipBtn = makeButton(card, "Equip",
					Color3.fromRGB(30, 140, 60), Color3.fromRGB(255, 255, 255),
					UDim2.new(0, 70, 0, 26), UDim2.new(0, 4, 0, btnY))
				equipBtn.ZIndex = 13
				equipBtn.MouseButton1Click:Connect(function()
					if remotes and remotes.RequestEquipCosmetic then
						remotes.RequestEquipCosmetic:FireServer({ itemId = itemId })
					end
				end)
			end
		end

		-- Sell button (always shown)
		local sellBtn = makeButton(card, "Sell",
			Color3.fromRGB(160, 30, 30), Color3.fromRGB(255, 220, 220),
			UDim2.new(0, 50, 0, 22), UDim2.new(1, -56, 0, btnY + 2))
		sellBtn.ZIndex = 13
		sellBtn.MouseButton1Click:Connect(function()
			if remotes and remotes.RequestSellItem then
				remotes.RequestSellItem:FireServer({ itemId = itemId, quantity = 1 })
			end
		end)
	end

	-- Update canvas size
	local layout = scrollFrame:FindFirstChildOfClass("UIGridLayout")
	if layout then
		scrollFrame.CanvasSize = UDim2.new(0, 0, 0, layout.AbsoluteContentSize.Y + 20)
	end
end

-- -- Open / Close --------------------------------------------------------------
function InventoryUI.Open()
	if not panel then return end
	isOpen = true
	refreshItems()
	local backdrop = gui:FindFirstChild("Backdrop")
	if backdrop then backdrop.Visible = true end
	panel.Visible = true
	TweenService:Create(panel, TweenInfo.new(0.2, Enum.EasingStyle.Quad), {
		Size = UDim2.new(0, 620, 0, 520)
	}):Play()
end

function InventoryUI.Close()
	if not panel then return end
	isOpen = false
	local backdrop = gui:FindFirstChild("Backdrop")
	if backdrop then backdrop.Visible = false end
	panel.Visible = false
end

function InventoryUI.Toggle()
	if isOpen then InventoryUI.Close() else InventoryUI.Open() end
end

-- -- Init ----------------------------------------------------------------------
function InventoryUI.Init(initialData)
	buildUI()

	-- Populate from initial data
	if initialData and initialData.Inventory then
		cachedInventory = initialData.Inventory
	end

	-- Listen for updates
	local remotes = RemoteEvents.Get()
	if remotes and remotes.InventoryUpdated then
		remotes.InventoryUpdated.OnClientEvent:Connect(function(data)
			if data then
				cachedInventory = data
				if isOpen then refreshItems() end
			end
		end)
	end

	-- Keyboard toggle
	UserInputService.InputBegan:Connect(function(input, processed)
		if processed then return end
		if input.KeyCode == Enum.KeyCode.I or input.KeyCode == Enum.KeyCode.B then
			InventoryUI.Toggle()
		end
	end)

	print("[InventoryUI] Initialized.")
end

return InventoryUI
