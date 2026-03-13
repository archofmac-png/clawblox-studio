/**
 * ClawBlox Test Runner — Wave F: Test Framework v2
 * Executes .clawtest.lua files using the wasmoon Lua VM
 * Format: describe/it/expect blocks (Jest-like)
 */

import { GameEngine, getTrajectory } from './game-engine.js';

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

// Wave F: v2 structured result shapes
export interface TestResultV2 {
  suite: string;
  test: string;
  passed: boolean;
  duration_ms: number;
  error: string | null;
  rewards: number[];
}

export interface TestSuiteV2 {
  // Backward compat fields (kept)
  file: string;
  results: TestResult[];
  passed: number;
  failed: number;
  duration: number;

  // New v2 fields
  success: boolean;
  skipped: number;
  duration_ms: number;
  seed?: number;
  deterministic?: boolean;
  results_v2: TestResultV2[];
  rewards_total: number;
  trajectory_frames: number;
}

const TEST_HARNESS = `
-- ClawBlox Test Harness (Wave F v2)
local _results = {}
local _currentSuite = ""
local _rewardHooks = {}   -- Wave F: reward_hook callbacks
local _rewards = {}       -- accumulated rewards per test

function describe(name, fn)
  _currentSuite = name
  fn()
end

-- Wave F: reward_hook — registers a callback(state) -> number
function reward_hook(callback)
  table.insert(_rewardHooks, callback)
end

-- Internal: call all reward hooks with current state, accumulate into dest
local function _collectRewards(dest)
  local state = {}
  if _cb_observe_state then
    state = _cb_observe_state() or {}
  end
  for _, hook in ipairs(_rewardHooks) do
    local ok, val = pcall(hook, state)
    if ok and type(val) == "number" then
      table.insert(dest, val)
    end
  end
end

function it(name, fn)
  local testRewards = {}
  local start = os.clock()
  local ok, err = pcall(fn)
  -- Collect rewards after test step
  _collectRewards(testRewards)
  local duration = os.clock() - start
  table.insert(_results, {
    suite = _currentSuite,
    name = _currentSuite .. " > " .. name,
    test = name,
    passed = ok,
    error = ok and nil or tostring(err),
    duration = math.floor(duration * 1000),
    rewards = testRewards,
  })
end

-- ── expect matchers ─────────────────────────────────────────────────────────

local function _deepEqual(a, b, tolerance)
  if type(a) ~= type(b) then return false end
  if type(a) == "number" and tolerance then
    return math.abs(a - b) <= tolerance
  end
  if type(a) ~= "table" then return a == b end
  -- table comparison
  for k, v in pairs(a) do
    if not _deepEqual(v, b[k], tolerance) then return false end
  end
  for k, v in pairs(b) do
    if not _deepEqual(a[k], v, tolerance) then return false end
  end
  return true
end

local function _deepDiff(a, b, prefix, tolerance)
  prefix = prefix or ""
  local diffs = {}
  if type(a) ~= "table" or type(b) ~= "table" then
    if not _deepEqual(a, b, tolerance) then
      table.insert(diffs, prefix .. ": expected " .. tostring(b) .. " got " .. tostring(a))
    end
    return diffs
  end
  local keys = {}
  local seen = {}
  for k in pairs(a) do keys[#keys+1] = k; seen[k] = true end
  for k in pairs(b) do if not seen[k] then keys[#keys+1] = k end end
  for _, k in ipairs(keys) do
    local sub = (prefix ~= "" and prefix .. "." or "") .. tostring(k)
    if a[k] == nil then
      table.insert(diffs, sub .. ": missing (expected " .. tostring(b[k]) .. ")")
    elseif b[k] == nil then
      table.insert(diffs, sub .. ": unexpected value " .. tostring(a[k]))
    else
      local subdiffs = _deepDiff(a[k], b[k], sub, tolerance)
      for _, d in ipairs(subdiffs) do table.insert(diffs, d) end
    end
  end
  return diffs
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

    -- ── Wave F: new matchers ─────────────────────────────────────────────

    -- expect.state_match(snapshot, options?)
    -- Deep-compares current observe state against snapshot.
    -- val is ignored here; this is a standalone matcher called as expect.state_match(...)
    state_match = function(snapshot, options)
      local state = {}
      if _cb_observe_state then
        state = _cb_observe_state() or {}
      end
      local tolerance = options and options.tolerance or nil
      local diffs = _deepDiff(state, snapshot, "", tolerance)
      if #diffs > 0 then
        local msg = "state_match failed:\\n" .. table.concat(diffs, "\\n")
        error(msg)
      end
    end,

    -- expect.performance(options, callback)
    -- Measures execution time of callback, fails if over max_ms.
    performance = function(options, callback)
      if type(options) == "function" then
        callback = options
        options = {}
      end
      options = options or {}
      local max_ms = options.max_ms
      local min_fps = options.min_fps

      local t0 = os.clock()
      local ok2, err2 = pcall(callback)
      local elapsed_ms = (os.clock() - t0) * 1000

      if not ok2 then
        error("performance callback error: " .. tostring(err2))
      end
      if max_ms and elapsed_ms > max_ms then
        error(string.format("performance: took %.2fms, exceeded max_ms=%s", elapsed_ms, tostring(max_ms)))
      end
      if min_fps then
        local frame_ms = 1000 / min_fps
        if elapsed_ms > frame_ms then
          error(string.format("performance: took %.2fms, exceeds frame budget for %dfps (%.2fms)", elapsed_ms, min_fps, frame_ms))
        end
      end
    end,
  }
end

function _getResults()
  return _results
end

-- Wave F: expose expect.state_match and expect.performance as top-level shortcuts
-- by wrapping expect into a callable table with those fields.
do
  local _rawExpect = expect
  local _expectTable = setmetatable({}, {
    __call = function(_, val)
      return _rawExpect(val)
    end,
    __index = {
      state_match = function(snapshot, options)
        _rawExpect(nil).state_match(snapshot, options)
      end,
      performance = function(options, callback)
        _rawExpect(nil).performance(options, callback)
      end,
    }
  })
  expect = _expectTable
end
`;

export async function runTestFile(filePath: string, luaCode: string): Promise<TestSuiteV2> {
  const engine = new GameEngine();
  const start = Date.now();

  try {
    await engine.initialize();

    // Wire up observe state callback so state_match works
    (engine as any)._exposeObserveCallback?.();

    const combined = TEST_HARNESS + '\n' + luaCode + '\nreturn _getResults()';
    const rawResults = await engine.executeRaw(combined);

    const results: TestResult[] = [];
    const resultsV2: TestResultV2[] = [];

    if (rawResults && typeof rawResults === 'object') {
      const entries = Array.isArray(rawResults) ? rawResults : Object.values(rawResults);
      for (const r of entries) {
        if (r && typeof r === 'object') {
          // Extract rewards from Lua table
          let rewards: number[] = [];
          if (r.rewards && typeof r.rewards === 'object') {
            const rArr = Array.isArray(r.rewards) ? r.rewards : Object.values(r.rewards);
            rewards = rArr.filter((v: unknown) => typeof v === 'number') as number[];
          }

          const errValue = (r.error === 'nil' || r.error === null || r.error === undefined) ? undefined : r.error;
          const errValueV2 = (r.error === 'nil' || r.error === null || r.error === undefined) ? null : r.error;

          // Legacy shape
          results.push({
            name: r.name || 'unknown',
            passed: r.passed === true,
            error: errValue,
            duration: r.duration || 0,
          });

          // v2 shape
          resultsV2.push({
            suite: r.suite || '',
            test: r.test || r.name || 'unknown',
            passed: r.passed === true,
            duration_ms: r.duration || 0,
            error: errValueV2,
            rewards,
          });
        }
      }
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const duration = Date.now() - start;

    // Compute total rewards across all tests
    const rewardsTotal = resultsV2.reduce(
      (sum, r) => sum + r.rewards.reduce((s, v) => s + v, 0),
      0
    );

    // Count trajectory frames recorded during test run
    const trajectoryFrames = getTrajectory().length;

    return {
      // Backward compat
      file: filePath,
      results,
      passed,
      failed,
      duration,
      // v2
      success: failed === 0,
      skipped: 0,
      duration_ms: duration,
      results_v2: resultsV2,
      rewards_total: rewardsTotal,
      trajectory_frames: trajectoryFrames,
    };
  } catch (err: any) {
    const duration = Date.now() - start;
    return {
      file: filePath,
      results: [{ name: 'Setup', passed: false, error: err.message, duration: 0 }],
      passed: 0,
      failed: 1,
      duration,
      success: false,
      skipped: 0,
      duration_ms: duration,
      results_v2: [{ suite: '', test: 'Setup', passed: false, duration_ms: 0, error: err.message, rewards: [] }],
      rewards_total: 0,
      trajectory_frames: 0,
    };
  } finally {
    engine.cleanup?.();
  }
}
