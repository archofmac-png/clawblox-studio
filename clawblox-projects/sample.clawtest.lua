-- sample.clawtest.lua
-- ClawBlox test suite example

describe("Basic Math", function()
  it("adds numbers correctly", function()
    expect(1 + 1):toBe(2)
  end)

  it("multiplies correctly", function()
    expect(3 * 4):toBe(12)
  end)

  it("handles subtraction", function()
    expect(10 - 3):toBe(7)
  end)
end)

describe("String Operations", function()
  it("concatenates strings", function()
    local s = "Hello" .. " " .. "World"
    expect(s):toBe("Hello World")
  end)

  it("checks string length", function()
    expect(#"ClawBlox"):toBe(8)
  end)
end)

describe("Table Operations", function()
  it("creates tables", function()
    local t = {1, 2, 3}
    expect(#t):toBe(3)
  end)

  it("contains item check", function()
    local t = {"apple", "banana", "cherry"}
    expect(t):toContain("banana")
  end)
end)

describe("Roblox Globals", function()
  it("workspace exists", function()
    expect(workspace):toBeNotNil()
  end)

  it("Players service exists", function()
    expect(Players):toBeNotNil()
  end)

  it("game object exists", function()
    expect(game):toBeNotNil()
  end)
end)
