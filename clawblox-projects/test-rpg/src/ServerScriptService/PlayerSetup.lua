-- PlayerSetup script
print("PlayerSetup running...")

Players.PlayerAdded:Connect(function(player)
  print("Player joined: " .. player.Name)
  -- Give starting coins
  local coins = Instance.new("IntValue")
  coins.Name = "Coins"
  coins.Value = GameConfig and GameConfig.StartingCoins or 50
  coins.Parent = player.leaderstats
end)

print("PlayerSetup ready")
