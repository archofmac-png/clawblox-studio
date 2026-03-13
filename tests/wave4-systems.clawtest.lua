-- Wave 4 Systems Test Suite
-- Tests: Physics/SphereCast, Network Bridge, A* Pathfinding
-- Uses assert() style (compatible with test harness)

describe("Physics System", function()
  it("Parts register in physics world when created", function()
    local part = Instance.new("Part")
    part.Name = "PhysicsTestPart"
    part.Position = Vector3.new(0, 0, 0)
    part.Size = Vector3.new(4, 4, 4)
    part.Parent = workspace
    assert(part ~= nil, "Part should be created")
    assert(part.Name == "PhysicsTestPart", "Part name should be PhysicsTestPart")
    assert(part.ClassName == "Part", "Part className should be Part")
  end)

  it("Part Position is set correctly", function()
    local part = Instance.new("Part")
    part.Name = "PosTest"
    part.Position = Vector3.new(50, 10, 25)
    part.Parent = workspace
    assert(part.Position ~= nil, "Position should be set")
    assert(part.Position.X == 50, "Position.X should be 50")
    assert(part.Position.Y == 10, "Position.Y should be 10")
    assert(part.Position.Z == 25, "Position.Z should be 25")
  end)

  it("Part Size is set correctly", function()
    local part = Instance.new("Part")
    part.Name = "SizeTest"
    part.Size = Vector3.new(8, 2, 6)
    part.Parent = workspace
    assert(part.Size ~= nil, "Size should be set")
    assert(part.Size.X == 8, "Size.X should be 8")
    assert(part.Size.Y == 2, "Size.Y should be 2")
    assert(part.Size.Z == 6, "Size.Z should be 6")
  end)

  it("workspace:SphereCast function exists", function()
    assert(type(workspace.SphereCast) == "function", "SphereCast must be a function")
  end)

  it("workspace:FindPartsInRadius function exists", function()
    assert(type(workspace.FindPartsInRadius) == "function", "FindPartsInRadius must be a function")
  end)

  it("SphereCast can be called with Vector3 args", function()
    local origin = Vector3.new(0, 5, 0)
    local direction = Vector3.new(0, -1, 0)
    local ok, result = pcall(function()
      return workspace:SphereCast(origin, 5, direction, 10)
    end)
    assert(ok == true, "SphereCast should not throw: " .. tostring(result))
  end)

  it("FindPartsInRadius can be called with Vector3 args", function()
    local center = Vector3.new(0, 0, 0)
    local ok, result = pcall(function()
      return workspace:FindPartsInRadius(center, 10)
    end)
    assert(ok == true, "FindPartsInRadius should not throw: " .. tostring(result))
  end)

  it("Multiple Parts can be created with different positions", function()
    local p1 = Instance.new("Part")
    p1.Name = "W4PhysA"
    p1.Position = Vector3.new(10, 0, 0)
    p1.Parent = workspace

    local p2 = Instance.new("Part")
    p2.Name = "W4PhysB"
    p2.Position = Vector3.new(-10, 0, 0)
    p2.Parent = workspace

    assert(p1.Position.X == 10, "p1.Position.X should be 10")
    assert(p2.Position.X == -10, "p2.Position.X should be -10")
  end)
end)

describe("RemoteEvent System", function()
  it("RemoteEvent can be created", function()
    local re = Instance.new("RemoteEvent")
    re.Name = "TestRemote"
    re.Parent = game:GetService("ReplicatedStorage")
    assert(re ~= nil, "RemoteEvent should be created")
    assert(re.ClassName == "RemoteEvent", "ClassName should be RemoteEvent")
  end)

  it("RemoteEvent has OnServerEvent", function()
    local re = Instance.new("RemoteEvent")
    re.Name = "ServerEventTest"
    assert(re.OnServerEvent ~= nil, "OnServerEvent must exist")
  end)

  it("RemoteEvent has OnClientEvent", function()
    local re = Instance.new("RemoteEvent")
    re.Name = "ClientEventTest"
    assert(re.OnClientEvent ~= nil, "OnClientEvent must exist")
  end)

  it("RemoteEvent.OnServerEvent:Connect works", function()
    local re = Instance.new("RemoteEvent")
    re.Name = "ConnectTest"
    local conn = re.OnServerEvent:Connect(function(player, data) end)
    assert(conn ~= nil, "Connect should return connection object")
  end)

  it("RemoteEvent:FireClient exists as method", function()
    local re = Instance.new("RemoteEvent")
    re.Name = "FireClientTest"
    assert(type(re.FireClient) == "function", "FireClient must be a function")
  end)

  it("RemoteEvent:FireServer exists as method", function()
    local re = Instance.new("RemoteEvent")
    re.Name = "FireServerTest"
    assert(type(re.FireServer) == "function", "FireServer must be a function")
  end)

  it("RemoteEvent:FireAllClients exists as method", function()
    local re = Instance.new("RemoteEvent")
    re.Name = "FireAllTest"
    assert(type(re.FireAllClients) == "function", "FireAllClients must be a function")
  end)

  it("RemoteEvent lifecycle: create, connect, fire", function()
    local re = Instance.new("RemoteEvent")
    re.Name = "LifecycleTest"
    re.Parent = game:GetService("ReplicatedStorage")

    local received = false
    re.OnServerEvent:Connect(function(player, value)
      received = (value == 99)
    end)

    -- Manually fire OnServerEvent (simulates network bridge calling it)
    re.OnServerEvent:Fire({Name="MockPlayer"}, 99)
    assert(received == true, "OnServerEvent handler should have received value 99")
  end)
end)

describe("Humanoid System", function()
  it("Humanoid can be created", function()
    local h = Instance.new("Humanoid")
    assert(h ~= nil, "Humanoid should be created")
    assert(h.ClassName == "Humanoid", "ClassName should be Humanoid")
  end)

  it("Humanoid has MoveTo method", function()
    local h = Instance.new("Humanoid")
    assert(type(h.MoveTo) == "function", "MoveTo must be a function")
  end)

  it("Humanoid has MoveToFinished event", function()
    local h = Instance.new("Humanoid")
    assert(h.MoveToFinished ~= nil, "MoveToFinished must exist")
  end)

  it("Humanoid has WalkSpeed property", function()
    local h = Instance.new("Humanoid")
    assert(h.WalkSpeed ~= nil, "WalkSpeed must be set")
    assert(h.WalkSpeed > 0, "WalkSpeed must be > 0")
  end)

  it("Humanoid has Health property", function()
    local h = Instance.new("Humanoid")
    assert(h.Health ~= nil, "Health must be set")
    assert(h.Health > 0, "Health must be > 0")
  end)

  it("Humanoid:MoveTo can be called without error", function()
    local h = Instance.new("Humanoid")
    local model = Instance.new("Model")
    model.Name = "TestNPC"
    h.Parent = model
    model.Parent = workspace

    local ok, err = pcall(function()
      h:MoveTo(Vector3.new(10, 0, 10))
    end)
    assert(ok == true, "MoveTo should not throw: " .. tostring(err))
  end)
end)

describe("PathfindingService", function()
  it("PathfindingService exists", function()
    local pf = game:GetService("PathfindingService")
    assert(pf ~= nil, "PathfindingService must exist")
  end)

  it("PathfindingService:CreatePath returns path object", function()
    local pf = game:GetService("PathfindingService")
    local path = pf:CreatePath({})
    assert(path ~= nil, "CreatePath must return a path object")
  end)

  it("Path has ComputeAsync method", function()
    local pf = game:GetService("PathfindingService")
    local path = pf:CreatePath({})
    assert(type(path.ComputeAsync) == "function", "ComputeAsync must be a function")
  end)

  it("Path has GetWaypoints method", function()
    local pf = game:GetService("PathfindingService")
    local path = pf:CreatePath({})
    assert(type(path.GetWaypoints) == "function", "GetWaypoints must be a function")
  end)

  it("Path:ComputeAsync can be called", function()
    local pf = game:GetService("PathfindingService")
    local path = pf:CreatePath({})
    local ok, err = pcall(function()
      path:ComputeAsync(Vector3.new(0,0,0), Vector3.new(20,0,20))
    end)
    assert(ok == true, "ComputeAsync should not throw: " .. tostring(err))
  end)

  it("Path:GetWaypoints returns a table", function()
    local pf = game:GetService("PathfindingService")
    local path = pf:CreatePath({})
    path:ComputeAsync(Vector3.new(0,0,0), Vector3.new(20,0,20))
    local waypoints = path:GetWaypoints()
    assert(type(waypoints) == "table", "GetWaypoints must return a table")
  end)

  it("Path has waypoints for reachable destination", function()
    local pf = game:GetService("PathfindingService")
    local path = pf:CreatePath({})
    path:ComputeAsync(Vector3.new(0,0,0), Vector3.new(20,0,20))
    local waypoints = path:GetWaypoints()
    local count = 0
    for _ in pairs(waypoints) do count = count + 1 end
    assert(count > 0, "Path to reachable destination must have waypoints, got: " .. count)
  end)

  it("Path:GetStatus returns Success for reachable destination", function()
    local pf = game:GetService("PathfindingService")
    local path = pf:CreatePath({})
    path:ComputeAsync(Vector3.new(0,0,0), Vector3.new(20,0,20))
    local status = path:GetStatus()
    assert(type(status) == "string", "GetStatus must return a string")
    assert(status == "Success", "Status should be Success, got: " .. tostring(status))
  end)
end)

describe("Wave 4 Integration", function()
  it("Physics world accessible via workspace methods", function()
    local ok1 = type(workspace.SphereCast) == "function"
    local ok2 = type(workspace.FindPartsInRadius) == "function"
    assert(ok1 and ok2, "Both SphereCast and FindPartsInRadius must exist")
  end)

  it("PathfindingService accessible via game:GetService", function()
    local ok, svc = pcall(function()
      return game:GetService("PathfindingService")
    end)
    assert(ok, "GetService(PathfindingService) should not throw")
    assert(svc ~= nil, "PathfindingService must not be nil")
  end)

  it("All Roblox core services still accessible after Wave 4", function()
    local services = {
      "Players", "Workspace", "ReplicatedStorage",
      "DataStoreService", "CollectionService", "RunService",
      "TweenService", "PathfindingService", "PhysicsService"
    }
    for _, name in ipairs(services) do
      local ok, err = pcall(function() return game:GetService(name) end)
      assert(ok, "Failed to get service " .. name .. ": " .. tostring(err))
    end
  end)

  it("PathfindingService:CreatePath with ComputeAsync end-to-end", function()
    local pf = game:GetService("PathfindingService")
    local path = pf:CreatePath({ AgentRadius = 2, AgentHeight = 5 })

    local ok, err = pcall(function()
      path:ComputeAsync(Vector3.new(0,0,0), Vector3.new(40,0,40))
    end)
    assert(ok, "ComputeAsync should not throw: " .. tostring(err))

    local waypoints = path:GetWaypoints()
    assert(type(waypoints) == "table", "Waypoints must be a table")
    local count = 0
    for _ in pairs(waypoints) do count = count + 1 end
    assert(count > 0, "Must have at least 1 waypoint for path (0,0,0) → (40,0,40)")
  end)
end)
