/**
 * ClawBlox Test Runner
 * Executes .clawtest.lua files using the wasmoon Lua VM
 * Format: describe/it/expect blocks (Jest-like)
 */

import { GameEngine } from './game-engine.js';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

export interface TestSuite {
  file: string;
  results: TestResult[];
  passed: number;
  failed: number;
  duration: number;
}

const TEST_HARNESS = `
-- ClawBlox Test Harness
local _results = {}
local _currentSuite = ""

function describe(name, fn)
  _currentSuite = name
  fn()
end

function it(name, fn)
  local start = os.clock()
  local ok, err = pcall(fn)
  local duration = os.clock() - start
  table.insert(_results, {
    name = _currentSuite .. " > " .. name,
    passed = ok,
    error = ok and nil or tostring(err),
    duration = math.floor(duration * 1000)
  })
end

function expect(val)
  return {
    toBe = function(self, expected)
      if val ~= expected then
        error("Expected " .. tostring(expected) .. " but got " .. tostring(val))
      end
    end,
    toEqual = function(self, expected)
      if val ~= expected then
        error("Expected " .. tostring(expected) .. " but got " .. tostring(val))
      end
    end,
    toBeNil = function(self)
      if val ~= nil then
        error("Expected nil but got " .. tostring(val))
      end
    end,
    toBeNotNil = function(self)
      if val == nil then
        error("Expected non-nil value")
      end
    end,
    toBeGreaterThan = function(self, n)
      if not (val > n) then
        error("Expected " .. tostring(val) .. " to be greater than " .. tostring(n))
      end
    end,
    toBeLessThan = function(self, n)
      if not (val < n) then
        error("Expected " .. tostring(val) .. " to be less than " .. tostring(n))
      end
    end,
    toBeCloseTo = function(self, expected, precision)
      precision = precision or 2
      local factor = 10^precision
      local diff = math.abs(val - expected)
      if diff >= (0.5 / factor) then
        error("Expected " .. tostring(val) .. " to be close to " .. tostring(expected) .. " (precision " .. tostring(precision) .. ")")
      end
    end,
    toBeNaN = function(self)
      if val == val then
        error("Expected NaN but got " .. tostring(val))
      end
    end,
    toBeFinite = function(self)
      if val ~= val or val == math.huge or val == -math.huge then
        error("Expected finite number but got " .. tostring(val))
      end
    end,
    toBeTruthy = function(self)
      if not val then
        error("Expected truthy value but got " .. tostring(val))
      end
    end,
    toBeFalsy = function(self)
      if val then
        error("Expected falsy value but got " .. tostring(val))
      end
    end,
    toMatch = function(self, pattern)
      if type(val) ~= "string" or not val:match(pattern) then
        error("Expected " .. tostring(val) .. " to match pattern " .. tostring(pattern))
      end
    end,
    toContain = function(self, item)
      if type(val) == "string" then
        if not val:find(item, 1, true) then
          error("Expected string to contain: " .. tostring(item))
        end
      elseif type(val) == "table" then
        local found = false
        for _, v in ipairs(val) do
          if v == item then found = true; break end
        end
        if not found then
          error("Expected table to contain: " .. tostring(item))
        end
      end
    end,
  }
end

function _getResults()
  return _results
end
`;

export async function runTestFile(filePath: string, luaCode: string): Promise<TestSuite> {
  const engine = new GameEngine();
  const start = Date.now();

  try {
    await engine.initialize();
    const combined = TEST_HARNESS + '\n' + luaCode + '\nreturn _getResults()';
    const rawResults = await engine.executeRaw(combined);

    const results: TestResult[] = [];
    if (rawResults && typeof rawResults === 'object') {
      // wasmoon may return a Lua table as a JS object (1-indexed)
      const entries = Array.isArray(rawResults) ? rawResults : Object.values(rawResults);
      for (const r of entries) {
        if (r && typeof r === 'object') {
          results.push({
            name: r.name || 'unknown',
            passed: r.passed === true,
            error: r.error,
            duration: r.duration || 0,
          });
        }
      }
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    return { file: filePath, results, passed, failed, duration: Date.now() - start };
  } catch (err: any) {
    return {
      file: filePath,
      results: [{ name: 'Setup', passed: false, error: err.message, duration: 0 }],
      passed: 0,
      failed: 1,
      duration: Date.now() - start,
    };
  } finally {
    engine.cleanup?.();
  }
}
