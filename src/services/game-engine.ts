/**
 * ClawBlox Game Engine — wasmoon (Lua 5.4 WASM)
 * Full instance registry, output capture, player simulation.
 */

import fs from 'fs';
import path from 'path';
import { LuaFactory, LuaEngine } from 'wasmoon';
import { randomUUID } from 'crypto';

// Wave 4: Physics world + Network bridge
import { physicsWorld } from './physics-world.js';
import { networkBridge } from './network-bridge.js';
import { pathfindingService } from './pathfinding.js';

// Wave A: Structured observability
import type { WsTypedEvent, SerializedPhysicsBody } from './observability.js';

// -------------------------------------------------------------------
// WebSocket broadcast hook
// -------------------------------------------------------------------
let _wsBroadcast: ((type: string, message: string) => void) | null = null;
export function setBroadcastFunction(fn: (type: string, message: string) => void) {
  _wsBroadcast = fn;
}

function broadcast(type: string, message: string) {
  if (_wsBroadcast) _wsBroadcast(type, message);
}

// -------------------------------------------------------------------
// Structured game event broadcasting (Wave 5 — Live Rendering Sync)
// -------------------------------------------------------------------
function broadcastEvent(payload: Record<string, unknown>) {
  if (_wsBroadcast) _wsBroadcast('game_event', JSON.stringify(payload));
}

// -------------------------------------------------------------------
// Wave A: Structured typed event broadcasting
// -------------------------------------------------------------------

/**
 * Emit a structured WebSocket event (Wave A Observability Layer).
 * Uses type 'structured_event' so clients can distinguish from legacy messages.
 */
export function broadcastStructuredEvent(event: WsTypedEvent): void {
  if (_wsBroadcast) {
    _wsBroadcast('structured_event', JSON.stringify(event));
  }
}

// -------------------------------------------------------------------
// Wave F: Coverage tracking — files require()-ed during test runs
export const _coveredFiles: Set<string> = new Set();

/** Reset coverage tracking (called on POST /api/game/start). */
export function resetCoverage(): void {
  _coveredFiles.clear();
}

/** Record a file as covered (called from Lua require() shim). */
export function recordCoveredFile(filename: string): void {
  _coveredFiles.add(filename);
}

// Wave B: Trajectory recorder
// -------------------------------------------------------------------
const TRAJECTORY_MAX_FRAMES = 10_000;

export interface SerializedBody {
  id: string;
  name: string;
  position: [number, number, number];
  velocity: [number, number, number];
  angularVelocity: [number, number, number];
  mass: number;
}

export interface TrajectoryFrame {
  tick: number;
  timestamp: number;
  seed: number;
  actions: string[];
  physicsState: { bodies: SerializedBody[] };
  instanceChanges: Array<{ id: string; property: string; oldValue: unknown; newValue: unknown }>;
  consoleOutput: Array<{ level: string; message: string }>;
}

// Ring buffer for trajectory frames
let _trajectory: TrajectoryFrame[] = [];
let _currentFrameActions: string[] = [];
let _currentFrameChanges: Array<{ id: string; property: string; oldValue: unknown; newValue: unknown }> = [];
let _currentFrameConsole: Array<{ level: string; message: string }> = [];

/** Clear all trajectory frames (called on game start). */
export function clearTrajectory(): void {
  _trajectory = [];
  _currentFrameActions = [];
  _currentFrameChanges = [];
  _currentFrameConsole = [];
}

/** Get all recorded trajectory frames. */
export function getTrajectory(): TrajectoryFrame[] {
  return _trajectory;
}

/** Record a Lua action (code executed) for the current tick. */
export function recordTrajectoryAction(code: string): void {
  _currentFrameActions.push(code);
}

/** Record an instance property change for the current tick. */
export function recordTrajectoryChange(id: string, property: string, oldValue: unknown, newValue: unknown): void {
  _currentFrameChanges.push({ id, property, oldValue, newValue });
}

/** Record console output for the current tick. */
export function recordTrajectoryConsole(level: string, message: string): void {
  _currentFrameConsole.push({ level, message });
}

/** Commit the current in-progress frame to the trajectory buffer. */
export function commitTrajectoryFrame(tick: number, seed: number, physicsState: TrajectoryFrame['physicsState']): void {
  const frame: TrajectoryFrame = {
    tick,
    timestamp: Date.now(),
    seed,
    actions: [..._currentFrameActions],
    physicsState,
    instanceChanges: [..._currentFrameChanges],
    consoleOutput: [..._currentFrameConsole],
  };
  // Push and cap at max frames (drop oldest)
  _trajectory.push(frame);
  if (_trajectory.length > TRAJECTORY_MAX_FRAMES) {
    _trajectory.shift();
  }
  // Reset current-frame buffers
  _currentFrameActions = [];
  _currentFrameChanges = [];
  _currentFrameConsole = [];
}

// -------------------------------------------------------------------
// Wave A: Global physics tick counter (monotonically increasing)
// -------------------------------------------------------------------
let _physicsTick = 0;

/**
 * Increment and return the physics tick counter.
 * Called by the physics step hook.
 */
export function incrementPhysicsTick(): number {
  return ++_physicsTick;
}

/**
 * Get the current physics tick value without incrementing.
 */
export function getPhysicsTick(): number {
  return _physicsTick;
}

/**
 * Reset the physics tick counter (called on game restart).
 */
export function resetPhysicsTick(): void {
  _physicsTick = 0;
}

// Track live player/enemy state for snapshot endpoint
interface PlayerState {
  name: string;
  position: { x: number; y: number; z: number };
  health: number;
  maxHealth: number;
}

interface EnemyState {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  health: number;
  maxHealth: number;
}

// Global live-state store (populated by broadcastEvent calls)
export const liveState = {
  players: new Map<string, PlayerState>(),
  enemies: new Map<string, EnemyState>(),
  reset() {
    this.players.clear();
    this.enemies.clear();
  }
};

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------
export interface GameState {
  status: 'stopped' | 'running' | 'paused';
  startTime?: number;
  players: string[];
  parts: string[];
  loadedProject?: string;
  scriptCount: number;
}

export interface ScriptResult {
  success: boolean;
  returns?: any[];
  output?: string[];
  error?: string;
}

export interface PlayerAction {
  action: 'join' | 'leave' | 'chat' | 'move';
  message?: string;
  position?: { x: number; y: number; z: number };
}

export interface SimulateResult {
  success: boolean;
  action: string;
  playerName: string;
  detail?: any;
  error?: string;
}

export interface TestResult {
  success: boolean;
  passed: boolean;
  description: string;
  assertion: string;
  error?: string;
  result?: any;
}

export interface InstanceRecord {
  id: string;
  Name: string;
  ClassName: string;
  parentId: string | null;
  properties: Record<string, any>;
}

// -------------------------------------------------------------------
// JS-side instance registry (Lua writes into this via callbacks)
// -------------------------------------------------------------------
class InstanceRegistry {
  private instances: Map<string, InstanceRecord> = new Map();
  private counter = 0;

  reset() {
    this.instances.clear();
    this.counter = 0;
  }

  create(className: string, name: string): string {
    const id = `inst_${++this.counter}`;
    this.instances.set(id, { id, Name: name || className, ClassName: className, parentId: null, properties: {} });
    return id;
  }

  setParent(id: string, parentId: string | null) {
    const inst = this.instances.get(id);
    if (inst) inst.parentId = parentId;
  }

  setProperty(id: string, key: string, value: any) {
    const inst = this.instances.get(id);
    if (inst) {
      if (key === 'Name') inst.Name = String(value);
      else inst.properties[key] = value;
    }
  }

  get(id: string) { return this.instances.get(id) || null; }

  getAll(): InstanceRecord[] {
    return Array.from(this.instances.values());
  }

  getChildren(parentId: string | null): InstanceRecord[] {
    return Array.from(this.instances.values()).filter(i => i.parentId === parentId);
  }

  findByPath(pathStr: string): InstanceRecord | null {
    const parts = pathStr.split('.');
    let current: InstanceRecord | null = null;

    // Find root
    const roots = Array.from(this.instances.values()).filter(i => i.parentId === null);
    current = roots.find(r => r.Name === parts[0]) || null;
    if (!current || parts.length === 1) return current;

    for (let i = 1; i < parts.length; i++) {
      const children = this.getChildren(current!.id);
      current = children.find(c => c.Name === parts[i]) || null;
      if (!current) return null;
    }
    return current;
  }

  toTree(parentId: string | null = null): any[] {
    return this.getChildren(parentId).map(inst => ({
      Name: inst.Name,
      ClassName: inst.ClassName,
      Path: this.getPath(inst.id),
      ChildCount: this.getChildren(inst.id).length,
    }));
  }

  getPath(id: string): string {
    const inst = this.instances.get(id);
    if (!inst) return '';
    if (!inst.parentId) return inst.Name;
    return this.getPath(inst.parentId) + '.' + inst.Name;
  }

  getStats() {
    return {
      count: this.instances.size,
      instances: this.toTree(null),
    };
  }
}

// -------------------------------------------------------------------
// Wave H: Advanced Debugging Infrastructure (must be before GameEngine class)
// -------------------------------------------------------------------

function generateUUID(): string {
  return randomUUID();
}

export interface Breakpoint {
  id: string;
  line: number;
  file?: string;
  condition?: string;
  hit_count: number;
}

export interface DebugLocalsState {
  paused: boolean;
  line: number;
  locals: Record<string, unknown>;
  upvalues: Record<string, unknown>;
  stack: string[];
}

export interface ProfileCall {
  fn: string;
  calls: number;
  total_ms: number;
  avg_ms: number;
}

export interface ProfileData {
  duration_ms: number;
  calls: ProfileCall[];
  hottest: string;
}

// Global debug state (shared across the singleton engine)
const _breakpoints: Map<string, Breakpoint> = new Map();
let _debugPaused = false;
let _debugCurrentLine = 0;
let _debugLocals: Record<string, unknown> = {};
let _debugUpvalues: Record<string, unknown> = {};
let _debugStack: string[] = [];
let _debugStepResolve: (() => void) | null = null;
let _debugContinueResolve: (() => void) | null = null;

// Profiling state
let _profilingActive = false;
let _profilingStartTime = 0;
const _profileCalls: Map<string, { calls: number; total_ms: number; last_start: number }> = new Map();

// Script hash registry for hot-reload
const _scriptHashes: Map<string, string> = new Map();

function hashCode(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = (Math.imul(31, h) + code.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

export function debugSetBreakpoint(line: number, file?: string, condition?: string): Breakpoint {
  const id = generateUUID();
  const bp: Breakpoint = { id, line, file, condition, hit_count: 0 };
  _breakpoints.set(id, bp);
  return bp;
}

export function debugGetBreakpoints(): Breakpoint[] {
  return Array.from(_breakpoints.values());
}

export function debugDeleteBreakpoint(id: string): boolean {
  return _breakpoints.delete(id);
}

export function debugGetLocalsState(): DebugLocalsState {
  return {
    paused: _debugPaused,
    line: _debugCurrentLine,
    locals: { ..._debugLocals },
    upvalues: { ..._debugUpvalues },
    stack: [..._debugStack],
  };
}

export async function debugStep(): Promise<DebugLocalsState | null> {
  if (!_debugPaused) return null;
  _debugPaused = false;
  if (_debugStepResolve) {
    _debugStepResolve();
    _debugStepResolve = null;
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  return debugGetLocalsState();
}

export async function debugContinue(): Promise<void> {
  if (!_debugPaused) return;
  _debugPaused = false;
  if (_debugContinueResolve) {
    _debugContinueResolve();
    _debugContinueResolve = null;
  }
  if (_debugStepResolve) {
    _debugStepResolve();
    _debugStepResolve = null;
  }
}

export function debugHotReload(file: string, code: string): { previous_hash: string; new_hash: string } {
  const prevHash = _scriptHashes.get(file) ?? '0000000';
  const newHash = hashCode(code);
  _scriptHashes.set(file, newHash);
  return { previous_hash: prevHash, new_hash: newHash };
}

export function profilingStart(): void {
  _profilingActive = true;
  _profilingStartTime = Date.now();
  _profileCalls.clear();
}

export function profilingStop(): ProfileData {
  const duration_ms = Date.now() - _profilingStartTime;
  _profilingActive = false;

  const calls: ProfileCall[] = [];
  let hottest = '';
  let hottestTotal = 0;

  for (const [fn, data] of _profileCalls.entries()) {
    const avg_ms = data.calls > 0 ? data.total_ms / data.calls : 0;
    calls.push({ fn, calls: data.calls, total_ms: data.total_ms, avg_ms });
    if (data.total_ms > hottestTotal) {
      hottestTotal = data.total_ms;
      hottest = fn;
    }
  }

  calls.sort((a, b) => b.total_ms - a.total_ms);
  return { duration_ms, calls, hottest };
}

export function isProfilingActive(): boolean {
  return _profilingActive;
}

export function recordProfileCall(fn: string, ms: number): void {
  if (!_profilingActive) return;
  const existing = _profileCalls.get(fn);
  if (existing) {
    existing.calls++;
    existing.total_ms += ms;
  } else {
    _profileCalls.set(fn, { calls: 1, total_ms: ms, last_start: 0 });
  }
}

export interface StructuredError {
  error: true;
  error_type: 'LuaRuntimeError' | 'LuaSyntaxError' | 'TimeoutError' | 'SessionNotFound' | 'ValidationError' | 'InternalError';
  message: string;
  traceback: string;
  context_snapshot: {
    tick: number;
    seed: number;
    instance_count: number;
  };
  timestamp: number;
}

export function classifyLuaError(err: Error): StructuredError['error_type'] {
  const msg = err.message ?? '';
  if (msg.includes('syntax') || msg.includes('unexpected symbol') || msg.includes("'<eof>'")) {
    return 'LuaSyntaxError';
  }
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return 'TimeoutError';
  }
  return 'LuaRuntimeError';
}

// -------------------------------------------------------------------
// End Wave H forward declarations
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Lua setup code
// -------------------------------------------------------------------
function buildLuaSetup(registry: InstanceRegistry): string {
  return `
-- ClawBlox Roblox Shim (Lua 5.4)

-- Event factory
local function newEvent()
  local listeners = {}
  local ev = {}
  function ev:Connect(fn)
    table.insert(listeners, fn)
    return { Disconnect = function() end, Connected = true }
  end
  function ev:Fire(...)
    for _, fn in ipairs(listeners) do pcall(fn, ...) end
  end
  function ev:Wait() return end
  return ev
end

-- Instance factory (backed by JS registry via callbacks)
local function newInstance(className, name)
  local instName = name or className
  local id = _cb_create(className, instName)

  local inst = {}
  inst._id = id
  inst.Name = instName
  inst.ClassName = className
  inst.Parent = nil
  inst._children = {}

  -- Property proxy
  local _props = { Name = instName, ClassName = className }
  setmetatable(inst, {
    __newindex = function(t, k, v)
      rawset(t, k, v)
      if k == "Name" then
        _cb_setprop(id, "Name", v)
      elseif k == "Parent" then
        local pid = v and rawget(v, "_id") or nil
        _cb_setparent(id, pid)
        -- add to parent._children
        if v and v._children then
          table.insert(v._children, t)
        end
      elseif k == "Position" or k == "Size" or k == "CFrame" then
        -- Pass Vector3/CFrame tables directly (not stringified) for physics sync
        _cb_setprop(id, k, v)
      else
        -- Serialize known value types instead of using raw tostring
        local serialized
        if type(v) == "boolean" then
          serialized = v  -- pass booleans as-is (not tostring)
        elseif type(v) == "number" then
          serialized = v  -- pass numbers as-is
        elseif type(v) == "table" then
          -- Color3 (has R, G, B fields)
          if v.R ~= nil and v.G ~= nil and v.B ~= nil then
            serialized = "Color3(" .. tostring(v.R) .. "," .. tostring(v.G) .. "," .. tostring(v.B) .. ")"
          -- Enum value: {Name=string, Value=number, EnumType=string} — check before BrickColor
          elseif v.EnumType ~= nil and v.Name ~= nil then
            serialized = "Enum." .. tostring(v.EnumType) .. "." .. tostring(v.Name)
          -- BrickColor: {Name=string} with no EnumType/Value
          elseif v.Name ~= nil and type(v.Name) == "string" and #v.Name > 0 then
            serialized = "BrickColor(" .. v.Name .. ")"
          else
            serialized = tostring(v)
          end
        else
          serialized = tostring(v)
        end
        _cb_setprop(id, k, serialized)
      end
    end
  })

  function inst:FindFirstChild(n)
    for _, c in ipairs(self._children) do if c.Name == n then return c end end
    return nil
  end

  function inst:WaitForChild(n, _timeout)
    return self:FindFirstChild(n)
  end

  function inst:GetChildren()
    local r = {}
    for _, c in ipairs(self._children) do table.insert(r, c) end
    return r
  end

  function inst:GetDescendants()
    local r = {}
    for _, c in ipairs(self._children) do
      table.insert(r, c)
      for _, d in ipairs(c:GetDescendants()) do table.insert(r, d) end
    end
    return r
  end

  function inst:GetFullName()
    if self.Parent and self.Parent.GetFullName then
      return self.Parent:GetFullName() .. "." .. self.Name
    end
    return self.Name
  end

  function inst:IsA(cn)
    return self.ClassName == cn
  end

  function inst:Destroy()
    rawset(self, "Parent", nil)
    _cb_setparent(id, nil)
    self._children = {}
  end

  function inst:Clone()
    return newInstance(self.ClassName, self.Name)
  end

  function inst:_addChild(child)
    rawset(child, "Parent", self)
    _cb_setparent(child._id, id)
    table.insert(self._children, child)
  end

  -- Value defaults
  if className == "IntValue" or className == "NumberValue" then
    inst.Value = 0
  elseif className == "StringValue" then
    inst.Value = ""
  elseif className == "BoolValue" then
    inst.Value = false
  end

  -- Shape defaults for Part classes
  if className == "Part" then
    inst.Shape = "Block"
    _cb_setprop(id, "Shape", "Block")
  elseif className == "WedgePart" then
    inst.Shape = "Wedge"
    _cb_setprop(id, "Shape", "Wedge")
  elseif className == "SpecialMesh" or className == "MeshPart" then
    inst.Shape = "Custom"
    _cb_setprop(id, "Shape", "Custom")
  end

  return inst
end

-- Root services (pre-registered)
local function makeService(className)
  local svc = newInstance(className, className)
  return svc
end

Players = makeService("Players")
Players.PlayerAdded = newEvent()
Players.PlayerRemoving = newEvent()
local _playersMap = {}

function Players:GetPlayers()
  local r = {}
  for _, p in pairs(_playersMap) do table.insert(r, p) end
  return r
end

function Players:FindFirstChild(n)
  return _playersMap[n]
end

function Players:AddPlayer(name)
  local player = newInstance("Player", name)
  player.UserId = math.random(100000, 999999)
  player.DisplayName = name
  player.Character = newInstance("Model", name)
  local leaderstats = newInstance("Folder", "leaderstats")
  player:_addChild(leaderstats)
  player.leaderstats = leaderstats
  _playersMap[name] = player
  Players:_addChild(player)
  Players.PlayerAdded:Fire(player)
  return player
end

function Players:RemovePlayer(name)
  local player = _playersMap[name]
  if player then
    Players.PlayerRemoving:Fire(player)
    _playersMap[name] = nil
    for i, c in ipairs(Players._children) do
      if c == player then table.remove(Players._children, i) break end
    end
  end
end

Workspace = makeService("Workspace")
local _baseplate = newInstance("Part", "Baseplate")
Workspace:_addChild(_baseplate)
workspace = Workspace

ReplicatedStorage = makeService("ReplicatedStorage")
ServerScriptService = makeService("ServerScriptService")

RunService = makeService("RunService")
RunService.Heartbeat = newEvent()
RunService.Stepped = newEvent()
function RunService:IsServer() return true end
function RunService:IsClient() return false end
function RunService:IsRunning() return true end

local DataStoreService = makeService("DataStoreService")
local _datastores = {}
function DataStoreService:GetDataStore(name)
  if not _datastores[name] then _datastores[name] = {} end
  local ds = _datastores[name]
  return {
    GetAsync = function(_, key) return ds[key] end,
    SetAsync = function(_, key, val) ds[key] = val end,
    UpdateAsync = function(_, key, fn) ds[key] = fn(ds[key]) end,
    RemoveAsync = function(_, key) local v = ds[key]; ds[key] = nil; return v end,
    IncrementAsync = function(_, key, n) ds[key] = (ds[key] or 0) + (n or 1); return ds[key] end,
  }
end

local CollectionService = makeService("CollectionService")
local _tags = {}
function CollectionService:AddTag(inst, tag)
  if not _tags[tag] then _tags[tag] = {} end
  table.insert(_tags[tag], inst)
end
function CollectionService:HasTag(inst, tag)
  if not _tags[tag] then return false end
  for _, i in ipairs(_tags[tag]) do if i == inst then return true end end
  return false
end
function CollectionService:GetTagged(tag)
  return _tags[tag] or {}
end
function CollectionService:GetInstanceAddedSignal(_tag) return newEvent() end

local TweenService = makeService("TweenService")
function TweenService:Create(inst, tweenInfo, props)
  return {
    Play = function(self)
      for k, v in pairs(props) do inst[k] = v end
    end,
    Cancel = function() end,
    Pause = function() end,
    Completed = newEvent(),
  }
end

local HttpService = makeService("HttpService")
function HttpService:JSONEncode(t) return tostring(t) end
function HttpService:JSONDecode(s) return {} end
function HttpService:GenerateGUID(_) return tostring(math.random(1e9)) end

local Debris = makeService("Debris")
function Debris:AddItem(inst, ttl) end

local _services = {
  Players = Players,
  Workspace = Workspace,
  ReplicatedStorage = ReplicatedStorage,
  ServerScriptService = ServerScriptService,
  RunService = RunService,
  DataStoreService = DataStoreService,
  CollectionService = CollectionService,
  TweenService = TweenService,
  HttpService = HttpService,
  Debris = Debris,
  Lighting = makeService("Lighting"),
  StarterPlayer = makeService("StarterPlayer"),
  PhysicsService = makeService("PhysicsService"),
  MessagingService = makeService("MessagingService"),
  PathfindingService = makeService("PathfindingService"),
  UserInputService = makeService("UserInputService"),
  SoundService = makeService("SoundService"),
  Chat = makeService("Chat"),
  Teams = makeService("Teams"),
}

game = {
  Name = "Game",
  GetService = function(_, name)
    local svc = _services[name]
    if not svc then error("Unknown service: " .. tostring(name)) end
    return svc
  end
}

Instance = {
  new = function(className, parent)
    local inst = newInstance(className, className)
    if parent then parent:_addChild(inst) end
    return inst
  end
}

-- task / wait
task = {
  wait = function(n) return n or 0 end,
  spawn = function(fn, ...) pcall(fn, ...) end,
  delay = function(n, fn, ...) pcall(fn, ...) end,
  defer = function(fn, ...) pcall(fn, ...) end,
}
wait = function(n) return n or 0 end
delay = function(n, fn, ...) pcall(fn, ...) end
spawn = function(fn, ...) pcall(fn, ...) end

-- Output capture (also routes to WS via _cb_out)
local _outBuf = {}
print = function(...)
  local parts = {}
  for i = 1, select("#", ...) do table.insert(parts, tostring(select(i, ...))) end
  local msg = table.concat(parts, "\\t")
  table.insert(_outBuf, msg)
  _cb_out("print", msg)
end
warn = function(...)
  local parts = {"[WARN]"}
  for i = 1, select("#", ...) do table.insert(parts, tostring(select(i, ...))) end
  local msg = table.concat(parts, "\\t")
  table.insert(_outBuf, msg)
  _cb_out("warn", msg)
end
local _orig_error = error
error = function(msg, level)
  local s = tostring(msg)
  table.insert(_outBuf, "[ERROR] " .. s)
  _cb_out("error", s)
  _orig_error(msg, level or 2)
end

-- Flush output buffer and reset
function _flushOutput()
  local out = {}
  for _, v in ipairs(_outBuf) do table.insert(out, v) end
  _outBuf = {}
  return out
end

-- Math types
local Vector3MT = {}
Vector3MT.__index = function(v, k)
  if k == "Magnitude" then
    return math.sqrt(v.X*v.X + v.Y*v.Y + v.Z*v.Z)
  elseif k == "Unit" then
    local mag = math.sqrt(v.X*v.X + v.Y*v.Y + v.Z*v.Z)
    if mag == 0 then return Vector3.new(0,0,0) end
    return Vector3.new(v.X/mag, v.Y/mag, v.Z/mag)
  end
end
Vector3MT.__add = function(a, b) return Vector3.new(a.X+b.X, a.Y+b.Y, a.Z+b.Z) end
Vector3MT.__sub = function(a, b) return Vector3.new(a.X-b.X, a.Y-b.Y, a.Z-b.Z) end
Vector3MT.__mul = function(a, b)
  if type(a) == "number" then return Vector3.new(a*b.X, a*b.Y, a*b.Z)
  elseif type(b) == "number" then return Vector3.new(a.X*b, a.Y*b, a.Z*b)
  else return Vector3.new(a.X*b.X, a.Y*b.Y, a.Z*b.Z) end
end
Vector3MT.__unm = function(a) return Vector3.new(-a.X, -a.Y, -a.Z) end
Vector3MT.__eq = function(a, b) return a.X==b.X and a.Y==b.Y and a.Z==b.Z end
Vector3MT.__tostring = function(v) return "Vector3("..v.X..","..v.Y..","..v.Z..")" end
Vector3 = {
  new = function(x,y,z)
    return setmetatable({X=x or 0, Y=y or 0, Z=z or 0}, Vector3MT)
  end,
  zero = setmetatable({X=0,Y=0,Z=0}, Vector3MT),
  one  = setmetatable({X=1,Y=1,Z=1}, Vector3MT),
}
Vector2 = { new = function(x,y) return {X=x or 0,Y=y or 0} end }
-- Full CFrame implementation with rotation matrix support
local CFrameMT = {}
CFrameMT.__index = CFrameMT
CFrameMT.__tostring = function(cf) return "CFrame("..cf.X..","..cf.Y..","..cf.Z..")" end
function CFrameMT.__mul(a, b)
  -- Matrix multiply rotation: new_R = a.R * b.R
  local aR = a.R
  local bR = b.R
  local r00 = aR[1]*bR[1] + aR[2]*bR[4] + aR[3]*bR[7]
  local r01 = aR[1]*bR[2] + aR[2]*bR[5] + aR[3]*bR[8]
  local r02 = aR[1]*bR[3] + aR[2]*bR[6] + aR[3]*bR[9]
  local r10 = aR[4]*bR[1] + aR[5]*bR[4] + aR[6]*bR[7]
  local r11 = aR[4]*bR[2] + aR[5]*bR[5] + aR[6]*bR[8]
  local r12 = aR[4]*bR[3] + aR[5]*bR[6] + aR[6]*bR[9]
  local r20 = aR[7]*bR[1] + aR[8]*bR[4] + aR[9]*bR[7]
  local r21 = aR[7]*bR[2] + aR[8]*bR[5] + aR[9]*bR[8]
  local r22 = aR[7]*bR[3] + aR[8]*bR[6] + aR[9]*bR[9]
  -- New position = a.R * b.position + a.position
  local nx = aR[1]*b.X + aR[2]*b.Y + aR[3]*b.Z + a.X
  local ny = aR[4]*b.X + aR[5]*b.Y + aR[6]*b.Z + a.Y
  local nz = aR[7]*b.X + aR[8]*b.Y + aR[9]*b.Z + a.Z
  -- Recover euler angles from rotation matrix (approximate, for serialization)
  local ry2 = math.atan(-r20, math.sqrt(r21*r21 + r22*r22))
  local rx2 = math.atan(r21, r22)
  local rz2 = math.atan(r10, r00)
  local cf = setmetatable({
    X=nx, Y=ny, Z=nz,
    rx=rx2, ry=ry2, rz=rz2,
    R={r00,r01,r02,r10,r11,r12,r20,r21,r22},
    Position={X=nx,Y=ny,Z=nz}
  }, CFrameMT)
  return cf
end
local function makeCFrame(x,y,z,rx,ry,rz,R)
  local cf = setmetatable({
    X=x,Y=y,Z=z,
    rx=rx,ry=ry,rz=rz,
    R=R,
    Position={X=x,Y=y,Z=z}
  }, CFrameMT)
  return cf
end
local function eulerToMatrix(rx2,ry2,rz2)
  local cx,sx = math.cos(rx2),math.sin(rx2)
  local cy,sy = math.cos(ry2),math.sin(ry2)
  local cz,sz = math.cos(rz2),math.sin(rz2)
  -- R = Rz * Ry * Rx
  return {
    cy*cz,             cz*sx*sy - cx*sz,  cx*cz*sy + sx*sz,
    cy*sz,             cx*cz + sx*sy*sz,  cx*sy*sz - cz*sx,
    -sy,               cy*sx,             cx*cy
  }
end
CFrame = {
  new = function(x,y,z,r00,r01,r02,r10,r11,r12,r20,r21,r22)
    x,y,z = x or 0, y or 0, z or 0
    local R
    if r00 ~= nil then
      R = {r00,r01,r02,r10,r11,r12,r20,r21,r22}
    else
      R = {1,0,0, 0,1,0, 0,0,1}
    end
    return makeCFrame(x,y,z,0,0,0,R)
  end,
  Angles = function(rx2,ry2,rz2)
    rx2,ry2,rz2 = rx2 or 0, ry2 or 0, rz2 or 0
    local R = eulerToMatrix(rx2,ry2,rz2)
    return makeCFrame(0,0,0,rx2,ry2,rz2,R)
  end,
  identity = makeCFrame(0,0,0,0,0,0,{1,0,0,0,1,0,0,0,1})
}
-- Color3 with Lerp support
local Color3MT = {}
Color3MT.__index = Color3MT
function Color3MT:Lerp(other, t2)
  return setmetatable({
    R = self.R + (other.R - self.R) * t2,
    G = self.G + (other.G - self.G) * t2,
    B = self.B + (other.B - self.B) * t2,
  }, Color3MT)
end
Color3 = {
  new = function(r,g,b)
    return setmetatable({R=r or 0,G=g or 0,B=b or 0}, Color3MT)
  end,
  fromRGB = function(r,g,b)
    return setmetatable({R=r/255,G=g/255,B=b/255}, Color3MT)
  end,
}
BrickColor = { new = function(n) return {Name=n} end }
UDim2 = { new = function(sx,ox,sy,oy) return {ScaleX=sx,OffsetX=ox,ScaleY=sy,OffsetY=oy} end }
UDim  = { new = function(s,o) return {Scale=s,Offset=o} end }
Rect  = { new = function(a,b,c,d) return {Min={X=a,Y=b},Max={X=c,Y=d}} end }
NumberSequence = { new = function(v) return {Value=v} end }
ColorSequence  = { new = function(v) return {Value=v} end }

-- Enum stubs with identity caching (so Enum.X.Y == Enum.X.Y is always true)
local _enumCache = {}
Enum = setmetatable({}, {
  __index = function(_, k)
    if not _enumCache[k] then
      local enumGroup = {}
      _enumCache[k] = setmetatable({}, {
        __index = function(_, k2)
          if not enumGroup[k2] then
            enumGroup[k2] = { Name = k2, Value = 0, EnumType = k }
          end
          return enumGroup[k2]
        end
      })
    end
    return _enumCache[k]
  end
})

script = newInstance("Script", "Script")
tick  = function() return os.clock() end
time  = function() return os.clock() end
typeof = function(v) return type(v) end
assert = function(v, msg) if not v then error(msg or "assertion failed") end return v end
pcall  = pcall
xpcall = xpcall

-- Wave F: require() tracking shim
local _origRequire = require
require = function(modname)
  if _cb_require_track then
    pcall(_cb_require_track, tostring(modname))
  end
  return _origRequire(modname)
end

-- Wave 4: workspace:SphereCast and :FindPartsInRadius shims
-- These call JS physics world callbacks
function Workspace:SphereCast(origin, radius, direction, distance)
  local dir = direction or Vector3.new(0,-1,0)
  local dist = distance or 100
  local results = {}
  if _cb_spherecast then
    results = _cb_spherecast(
      origin.X or 0, origin.Y or 0, origin.Z or 0,
      dir.X or 0, dir.Y or -1, dir.Z or 0,
      radius or 5, dist
    ) or {}
  end
  return results
end

function Workspace:FindPartsInRadius(center, radius)
  local results = {}
  if _cb_findparts then
    results = _cb_findparts(
      center.X or 0, center.Y or 0, center.Z or 0,
      radius or 5
    ) or {}
  end
  return results
end

-- Wave 4: PathfindingService:CreatePath / path:ComputeAsync / path:GetWaypoints
local PathfindingService = _services["PathfindingService"]
function PathfindingService:CreatePath(params)
  local pathObj = {
    _waypoints = {},
    _status = "NoPath",
  }
  function pathObj:ComputeAsync(from, to)
    if _cb_findpath then
      local waypoints = _cb_findpath(
        from.X or 0, from.Y or 0, from.Z or 0,
        to.X or 0, to.Y or 0, to.Z or 0
      ) or {}
      self._waypoints = waypoints
      self._status = #waypoints > 0 and "Success" or "NoPath"
    end
  end
  function pathObj:GetWaypoints()
    local result = {}
    for _, wp in ipairs(self._waypoints) do
      table.insert(result, {
        Position = Vector3.new(wp.x or 0, wp.y or 0, wp.z or 0),
        Action = Enum.PathWaypointAction.Walk,
      })
    end
    return result
  end
  function pathObj:GetStatus()
    return self._status
  end
  return pathObj
end

-- Wave 4: Humanoid:MoveTo shim
local _humanoidMoveToOrig = {}
-- Patch is applied when Humanoid instances are created via Instance.new
-- For now, expose a global hook for Humanoid:MoveTo
_humanoidMoveTo = function(humanoid, position)
  if _cb_moveagent and humanoid then
    local name = (humanoid.Parent and humanoid.Parent.Name) or "Agent"
    _cb_moveagent(name,
      0, 0, 0, -- from: use origin as placeholder
      position.X or 0, position.Y or 0, position.Z or 0,
      16 -- default speed
    )
  end
end

-- RemoteEvent enhancements: FireClient / FireServer routing via JS
local _remoteEventMeta = {
  FireClient = function(self, player, ...)
    if _cb_fire_client and player then
      local pname = (type(player) == "table" and player.Name) or tostring(player)
      _cb_fire_client(pname, self.Name or "Remote", ...)
    end
  end,
  FireServer = function(self, ...)
    if _cb_fire_server then
      _cb_fire_server(self.Name or "Remote", ...)
    end
  end,
  FireAllClients = function(self, ...)
    if _cb_fire_all_clients then
      _cb_fire_all_clients(self.Name or "Remote", ...)
    end
  end,
}

-- Patch Instance.new to add RemoteEvent methods
local _origInstanceNew = Instance.new
Instance.new = function(className, parent)
  local inst = _origInstanceNew(className, parent)
  if className == "RemoteEvent" then
    inst.OnServerEvent = newEvent()
    inst.OnClientEvent = newEvent()
    inst.FireClient = _remoteEventMeta.FireClient
    inst.FireServer = _remoteEventMeta.FireServer
    inst.FireAllClients = _remoteEventMeta.FireAllClients
  elseif className == "Humanoid" then
    inst.MoveTo = function(self, pos)
      _humanoidMoveTo(self, pos)
    end
    inst.MoveToFinished = newEvent()
    inst.WalkSpeed = 16
    inst.Health = 100
    inst.MaxHealth = 100
  end
  return inst
end
`;
}

// -------------------------------------------------------------------
// Script collection helpers
// -------------------------------------------------------------------
interface ScriptEntry {
  name: string;
  path: string;
  source: string;
  service: string;
}

function collectScripts(dir: string, service: string): ScriptEntry[] {
  const results: ScriptEntry[] = [];
  if (!fs.existsSync(dir)) return results;
  function recurse(current: string) {
    for (const item of fs.readdirSync(current)) {
      const full = path.join(current, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) { recurse(full); }
      else if (item.endsWith('.luau') || item.endsWith('.lua')) {
        try { results.push({ name: item, path: full, source: fs.readFileSync(full, 'utf-8'), service }); }
        catch (_) {}
      }
    }
  }
  recurse(dir);
  return results;
}

// -------------------------------------------------------------------
// Game Engine
// -------------------------------------------------------------------
export class GameEngine {
  private engine: LuaEngine | null = null;
  private factory: LuaFactory | null = null;
  private registry = new InstanceRegistry();
  private status: 'stopped' | 'running' | 'paused' = 'stopped';
  private startTime?: number;
  private loadedProject?: string;
  private scriptCount = 0;
  private chatLog: Array<{ player: string; message: string; timestamp: number }> = [];

  // ── Wave A: Determinism metadata ──────────────────────────────────────
  /** Random seed generated when the game starts. Used for Wave B determinism. */
  private seed = 0;
  /** Timestamp (ms) when the current game session started. */
  private startedAt = 0;

  // ── Wave B: Deterministic mode ────────────────────────────────────────
  /** Whether deterministic mode is active. */
  private _deterministic = false;

  /** Get deterministic mode flag. */
  isDeterministic(): boolean { return this._deterministic; }

  /** Set deterministic mode + seed. */
  setDeterministicMode(enabled: boolean, seed?: number): void {
    this._deterministic = enabled;
    if (enabled) {
      this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    }
  }

  // DataStore snapshot for observability
  private _dataStoreSnapshot: Record<string, Record<string, unknown>> = {};

  /**
   * Get the current game seed.
   */
  getSeed(): number { return this.seed; }

  /**
   * Get the timestamp when the current session started.
   */
  getStartedAt(): number { return this.startedAt; }

  private async initLua(): Promise<void> {
    if (this.engine) return;
    this.factory = new LuaFactory();
    this.engine = await this.factory.createEngine();

    // JS callbacks available to Lua
    this.engine.global.set('_cb_create', (className: string, name: string): string => {
      const id = this.registry.create(className, name);
      // Wave 4: Register Parts in physics world
      if (className === 'Part' || className === 'BasePart' || className === 'MeshPart' || className === 'SpecialMesh' || className === 'WedgePart') {
        const inst = this.registry.get(id);
        if (inst) physicsWorld.registerPart(inst);
      }
      // Wave 5: Emit part_created when a Part is instantiated
      // (position/size will be emitted via part_moved/part_created update when Parent is set)
      if (className === 'Part' || className === 'BasePart' || className === 'MeshPart' || className === 'WedgePart') {
        const defaultShape = className === 'WedgePart' ? 'Wedge' : 'Block';
        broadcastEvent({ event: 'part_created', id, name, className, shape: defaultShape, position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 1, z: 4 }, rotation: { rx: 0, ry: 0, rz: 0 }, color: '#c0c0c0' });
      }
      // Wave A: Emit structured instance:created event
      const inst = this.registry.get(id);
      broadcastStructuredEvent({
        event: 'instance:created',
        id,
        className,
        name,
        parentId: inst?.parentId ?? null,
        properties: {},
      });
      return id;
    });
    this.engine.global.set('_cb_setparent', (id: string, parentId: string | null) => {
      this.registry.setParent(id, parentId);
    });
    this.engine.global.set('_cb_setprop', (id: string, key: string, value: any) => {
      // Wave 4: For Vector3 properties coming from Lua (wasmoon proxy tables),
      // eagerly extract X/Y/Z into a plain JS object for physics sync.
      let storedValue = value;
      if (value !== null && value !== undefined && typeof value === 'object') {
        try {
          // Try to extract X, Y, Z (wasmoon table proxy exposes get())
          const X = value.X ?? value.x ?? value['X'] ?? value['x'];
          const Y = value.Y ?? value.y ?? value['Y'] ?? value['y'];
          const Z = value.Z ?? value.z ?? value['Z'] ?? value['z'];
          if (X !== undefined || Y !== undefined || Z !== undefined) {
            storedValue = { X: Number(X ?? 0), Y: Number(Y ?? 0), Z: Number(Z ?? 0) };
          }
        } catch (_) {
          // Keep raw value if extraction fails
        }
      }
      // Wave 5.5: For CFrame, also extract rotation (rx, ry, rz) from the wasmoon proxy
      if (key === 'CFrame' && value !== null && value !== undefined && typeof value === 'object') {
        try {
          const rx = value.rx ?? value['rx'];
          const ry = value.ry ?? value['ry'];
          const rz = value.rz ?? value['rz'];
          const X = value.X ?? value['X'] ?? 0;
          const Y = value.Y ?? value['Y'] ?? 0;
          const Z = value.Z ?? value['Z'] ?? 0;
          storedValue = {
            X: Number(X), Y: Number(Y), Z: Number(Z),
            rx: Number(rx ?? 0), ry: Number(ry ?? 0), rz: Number(rz ?? 0),
          };
          // Also store position directly so Position queries work
          this.registry.setProperty(id, 'Position', { X: Number(X), Y: Number(Y), Z: Number(Z) });
          this.registry.setProperty(id, '_rotation', { rx: Number(rx ?? 0), ry: Number(ry ?? 0), rz: Number(rz ?? 0) });
        } catch (_) {
          // Keep storedValue as-is
        }
      }
      // Wave A: Capture old value before writing, then emit instance:changed
      const existingInst = this.registry.get(id);
      const oldValue = existingInst ? (existingInst.properties[key] ?? null) : null;
      this.registry.setProperty(id, key, storedValue);
      // Emit structured change event (skip internal/function values)
      if (typeof storedValue !== 'function') {
        broadcastStructuredEvent({
          event: 'instance:changed',
          id,
          property: key,
          oldValue,
          newValue: storedValue,
        });
        // Wave B: Record instance change for trajectory
        if (typeof storedValue !== 'function') {
          recordTrajectoryChange(id, key, oldValue, storedValue);
        }
      }
      // Wave 4: Sync Part position/size changes to physics world
      const inst = this.registry.get(id);
      if (inst && (inst.ClassName === 'Part' || inst.ClassName === 'BasePart')) {
        if (key === 'Position' || key === 'Size' || key === 'CFrame') {
          physicsWorld.syncPartPosition(inst);
        }
        // Auto-register if not yet in physics world (e.g. class was set after creation)
        physicsWorld.registerPart(inst);
      }
      // Wave 4: Register obstacles for pathfinding (Parts with CanCollide=true)
      if (inst && key === 'CanCollide' && (value === 'true' || value === true)) {
        const pos = inst.properties['Position'];
        const size = inst.properties['Size'];
        if (pos && size) {
          const posV = typeof pos === 'object' ? pos as Record<string,number> : null;
          const sizeV = typeof size === 'object' ? size as Record<string,number> : null;
          if (posV && sizeV) {
            pathfindingService.addObstacle(id, 
              { x: Number(posV['X']??posV['x']??0), y: Number(posV['Y']??posV['y']??0), z: Number(posV['Z']??posV['z']??0) },
              { x: Number(sizeV['X']??sizeV['x']??4), y: Number(sizeV['Y']??sizeV['y']??1), z: Number(sizeV['Z']??sizeV['z']??4) }
            );
          }
        }
      }

      // Wave 5: Emit live rendering events
      if (inst) {
        const isPart = inst.ClassName === 'Part' || inst.ClassName === 'BasePart' || inst.ClassName === 'MeshPart' || inst.ClassName === 'WedgePart';
        const isHumanoid = inst.ClassName === 'Humanoid';

        if (isPart && (key === 'Position' || key === 'CFrame')) {
          // part_moved — emit with updated position + rotation
          const pos = storedValue as Record<string, number>;
          const posX = Number(pos['X'] ?? pos['x'] ?? 0);
          const posY = Number(pos['Y'] ?? pos['y'] ?? 0);
          const posZ = Number(pos['Z'] ?? pos['z'] ?? 0);
          const rot = inst.properties['_rotation'] as Record<string,number> | null;
          broadcastEvent({
            event: 'part_moved', id, position: { x: posX, y: posY, z: posZ },
            rotation: rot ? { rx: rot['rx'] ?? 0, ry: rot['ry'] ?? 0, rz: rot['rz'] ?? 0 } : { rx: 0, ry: 0, rz: 0 }
          });
        }

        if (isPart && key === 'Size') {
          // part size updated — emit full part_created again to update size
          const sizeV = storedValue as Record<string, number>;
          const pos = inst.properties['Position'] as Record<string, number> | null;
          const rot = inst.properties['_rotation'] as Record<string,number> | null;
          const px = pos ? Number(pos['X'] ?? pos['x'] ?? 0) : 0;
          const py = pos ? Number(pos['Y'] ?? pos['y'] ?? 0) : 0;
          const pz = pos ? Number(pos['Z'] ?? pos['z'] ?? 0) : 0;
          const shape = (inst.properties['Shape'] as string) ?? (inst.ClassName === 'WedgePart' ? 'Wedge' : 'Block');
          broadcastEvent({
            event: 'part_created', id, name: inst.Name,
            className: inst.ClassName,
            shape,
            position: { x: px, y: py, z: pz },
            size: { x: Number(sizeV['X'] ?? sizeV['x'] ?? 4), y: Number(sizeV['Y'] ?? sizeV['y'] ?? 1), z: Number(sizeV['Z'] ?? sizeV['z'] ?? 4) },
            rotation: rot ? { rx: rot['rx'] ?? 0, ry: rot['ry'] ?? 0, rz: rot['rz'] ?? 0 } : { rx: 0, ry: 0, rz: 0 },
            color: '#c0c0c0'
          });
        }

        // Health changes — for enemies (Parts tagged as Enemy) and players (Humanoid)
        if (isHumanoid && (key === 'Health' || key === 'MaxHealth')) {
          const parentInst = inst.parentId ? this.registry.get(inst.parentId) : null;
          const targetName = parentInst ? parentInst.Name : inst.Name;
          const currentHealth = Number(key === 'Health' ? value : (inst.properties['Health'] ?? 100));
          const maxHealth = Number(key === 'MaxHealth' ? value : (inst.properties['MaxHealth'] ?? 100));
          broadcastEvent({ event: 'health_changed', target: targetName, health: currentHealth, maxHealth });

          // Update player state in liveState
          if (liveState.players.has(targetName)) {
            const ps = liveState.players.get(targetName)!;
            if (key === 'Health') ps.health = currentHealth;
            if (key === 'MaxHealth') ps.maxHealth = maxHealth;
          }
        }
      }
    });
    this.engine.global.set('_cb_out', (type: string, msg: string) => {
      broadcast(type, msg);
      // Wave A: Also emit structured console event
      const level = (type === 'warn' || type === 'error') ? type : 'print';
      broadcastStructuredEvent({
        event: 'console:structured',
        level: level as 'print' | 'warn' | 'error',
        message: msg,
        traceback: null,
        tick: getPhysicsTick(),
      });
      // Wave B: Record for trajectory
      recordTrajectoryConsole(level, msg);
    });

    // Wave F: require() tracking callback
    this.engine.global.set('_cb_require_track', (filename: string) => {
      recordCoveredFile(filename);
    });

    // Wave 4: Physics callbacks
    this.engine.global.set('_cb_spherecast', (
      ox: number, oy: number, oz: number,
      dx: number, dy: number, dz: number,
      radius: number, distance: number
    ): Array<Record<string, unknown>> => {
      const hits = physicsWorld.sphereCast(
        { x: ox, y: oy, z: oz },
        { x: dx, y: dy, z: dz },
        radius,
        distance
      );
      // Wave 5: Emit attack_range event for visual feedback in viewport
      broadcastEvent({ event: 'attack_range', from: { x: ox, y: oy, z: oz }, radius, duration: 0.5 });
      // Return as plain JS array that Lua can iterate
      return hits.map(h => ({ Name: h.Name, ClassName: h.ClassName }));
    });

    this.engine.global.set('_cb_findparts', (
      cx: number, cy: number, cz: number,
      radius: number
    ): Array<Record<string, unknown>> => {
      const hits = physicsWorld.findPartsInRadius({ x: cx, y: cy, z: cz }, radius);
      return hits.map(h => ({ Name: h.Name, ClassName: h.ClassName }));
    });

    // Wave 4: Pathfinding callbacks
    this.engine.global.set('_cb_findpath', (
      fx: number, fy: number, fz: number,
      tx: number, ty: number, tz: number
    ): Array<Record<string, number>> => {
      const result = pathfindingService.findPath(
        { x: fx, y: fy, z: fz },
        { x: tx, y: ty, z: tz }
      );
      return result.path as unknown as Array<Record<string, number>>;
    });

    this.engine.global.set('_cb_moveagent', (
      agentName: string,
      fx: number, fy: number, fz: number,
      tx: number, ty: number, tz: number,
      speed: number
    ) => {
      pathfindingService.moveAgent(
        agentName,
        { x: fx, y: fy, z: fz },
        { x: tx, y: ty, z: tz },
        speed
      );
    });

    // Wave 4: NetworkBridge callbacks
    this.engine.global.set('_cb_fire_client', (
      playerName: string,
      remoteName: string,
      ...args: unknown[]
    ) => {
      networkBridge.fireClient(playerName, remoteName, args).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GameEngine] fireClient error:', msg);
      });
    });

    this.engine.global.set('_cb_fire_server', (
      remoteName: string,
      ...args: unknown[]
    ) => {
      networkBridge.fireServer('server', remoteName, args).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GameEngine] fireServer error:', msg);
      });
    });

    this.engine.global.set('_cb_fire_all_clients', (
      remoteName: string,
      ...args: unknown[]
    ) => {
      networkBridge.fireAllClients(remoteName, args).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GameEngine] fireAllClients error:', msg);
      });
    });

    await this.engine.doString(buildLuaSetup(this.registry));
  }

  private async flushOutput(): Promise<string[]> {
    try {
      // wasmoon doString returns first return value directly (not an array)
      const result = await this.engine!.doString('return table.concat(_flushOutput(), "\\n")');
      if (typeof result === 'string' && result.length > 0) return result.split('\n');
      return [];
    } catch (_) { return []; }
  }

  async start(opts?: { deterministic?: boolean; seed?: number }): Promise<GameState & { seed: number; deterministic: boolean }> {
    if (this.engine) {
      try { this.engine.global.close(); } catch (_) {}
      this.engine = null;
    }
    this.registry.reset();
    // Wave 4: Reset physics world when game restarts
    physicsWorld.reset();
    // Wave 5: Reset live rendering state and notify frontend
    liveState.reset();
    broadcastEvent({ event: 'game_reset' });
    // Wave A: Generate determinism seed and record start timestamp
    this._deterministic = opts?.deterministic ?? false;
    if (this._deterministic) {
      this.seed = opts?.seed ?? Math.floor(Math.random() * 2 ** 31);
    } else {
      this.seed = Math.floor(Math.random() * 2 ** 31);
    }
    this.startedAt = Date.now();
    this._dataStoreSnapshot = {};
    resetPhysicsTick();
    // Wave B: Clear trajectory on every start
    clearTrajectory();
    // Wave F: Reset coverage on game start
    resetCoverage();
    // Wave B: Lock physics to fixed timestep in deterministic mode
    physicsWorld.setDeterministicMode(this._deterministic);
    await this.initLua();
    // Wave B: Seed Lua RNG when deterministic
    if (this._deterministic) {
      try {
        await this.engine!.doString(`math.randomseed(${this.seed})`);
      } catch (_) {}
    }
    this.status = 'running';
    this.startTime = Date.now();
    this.loadedProject = undefined;
    this.scriptCount = 0;
    this.chatLog = [];
    return { ...this.getState(), seed: this.seed, deterministic: this._deterministic };
  }

  stop(): GameState {
    this.status = 'stopped';
    this.startTime = undefined;
    return this.getState();
  }

  async execute(code: string, opts?: { deterministic?: boolean; seed?: number }): Promise<ScriptResult & { seed?: number; deterministic?: boolean }> {
    await this.initLua();
    // Wave B: Handle per-execute deterministic mode (overrides game-level setting)
    const execDeterministic = opts?.deterministic ?? this._deterministic;
    const execSeed = opts?.seed ?? this.seed;
    if (execDeterministic) {
      try {
        await this.engine!.doString(`math.randomseed(${execSeed})`);
      } catch (_) {}
    }
    // Wave B: Record this action for trajectory
    recordTrajectoryAction(code);
    try {
      // Wrap user script in table.pack() to capture ALL return values
      const wrappedCode = `
local __packed = table.pack(
  (function()
    ${code}
  end)()
)
local __out = {}
for i = 1, __packed.n do
  __out[i] = __packed[i]
end
return __out
`;
      const result = await this.engine!.doString(wrappedCode);
      const output = await this.flushOutput();
      const returns: any[] = [];

      if (result !== undefined && result !== null && typeof result === 'object') {
        // result is a wasmoon table proxy ({1: val1, 2: val2, ...} or array-like)
        try {
          // Try standard array iteration first
          const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
          for (const v of arr) {
            if (v === undefined) continue;
            if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
              returns.push(v);
            } else if (v !== null && typeof v === 'object') {
              try {
                returns.push(JSON.parse(JSON.stringify(v)));
              } catch {
                returns.push(String(v));
              }
            } else {
              returns.push(String(v));
            }
          }
        } catch {
          returns.push(String(result));
        }
      } else if (result !== undefined && result !== null) {
        returns.push(result);
      }

      // Wave B: Commit trajectory frame after each execute
      const physBodies = physicsWorld.getSerializedBodies();
      commitTrajectoryFrame(getPhysicsTick(), execSeed, { bodies: physBodies });
      const resultPayload: ScriptResult & { seed?: number; deterministic?: boolean } = { success: true, returns, output };
      if (execDeterministic) { resultPayload.seed = execSeed; resultPayload.deterministic = true; }
      return resultPayload;
    } catch (err: any) {
      const output = await this.flushOutput();
      return { success: false, error: err.message, output };
    }
  }

  async simulatePlayer(name: string, action: PlayerAction): Promise<SimulateResult> {
    await this.initLua();
    switch (action.action) {
      case 'join': {
        const r = await this.execute(`Players:AddPlayer("${name}")`);
        if (!r.success) return { success: false, action: 'join', playerName: name, error: r.error };
        // Wave 5: Emit player_joined event
        const spawnPos = { x: 0, y: 5, z: 0 };
        liveState.players.set(name, { name, position: spawnPos, health: 100, maxHealth: 100 });
        broadcastEvent({ event: 'player_joined', name, position: spawnPos });
        return { success: true, action: 'join', playerName: name, detail: { name, userId: Math.floor(Math.random() * 900000) + 100000 } };
      }
      case 'leave': {
        const r = await this.execute(`Players:RemovePlayer("${name}")`);
        if (!r.success) return { success: false, action: 'leave', playerName: name, error: r.error };
        // Wave 5: Emit player_left event
        liveState.players.delete(name);
        broadcastEvent({ event: 'player_left', name });
        return { success: true, action: 'leave', playerName: name };
      }
      case 'chat':
        this.chatLog.push({ player: name, message: action.message || '', timestamp: Date.now() });
        return { success: true, action: 'chat', playerName: name, detail: { message: action.message } };
      case 'move': {
        // Wave 5: Emit player_moved event
        const pos = action.position ?? { x: 0, y: 5, z: 0 };
        const ps = liveState.players.get(name);
        if (ps) ps.position = pos;
        broadcastEvent({ event: 'player_moved', name, position: pos });
        return { success: true, action: 'move', playerName: name, detail: action.position };
      }
      default:
        return { success: false, action: (action as any).action, playerName: name, error: 'Unknown action' };
    }
  }

  async runTest(assertion: string, description: string): Promise<TestResult> {
    await this.initLua();
    try {
      // wasmoon returns the value directly
      const val = await this.engine!.doString(`return (${assertion})`);
      const passed = val === true || (val !== false && val !== null && val !== undefined);
      return { success: true, passed, description, assertion, result: { value: val } };
    } catch (err: any) {
      return { success: false, passed: false, description, assertion, error: err.message };
    }
  }

  async loadProject(projectPath: string): Promise<{ loaded: ScriptEntry[]; errors: string[] }> {
    if (!fs.existsSync(projectPath)) throw new Error(`Path not found: ${projectPath}`);
    const order = [
      { dir: path.join(projectPath, 'src', 'ReplicatedStorage'), service: 'ReplicatedStorage' },
      { dir: path.join(projectPath, 'src', 'ServerScriptService'), service: 'ServerScriptService' },
      { dir: path.join(projectPath, 'src', 'StarterPlayer', 'StarterPlayerScripts'), service: 'StarterPlayerScripts' },
    ];
    const allScripts: ScriptEntry[] = [];
    for (const { dir, service } of order) allScripts.push(...collectScripts(dir, service));
    await this.initLua();
    const errors: string[] = [];
    for (const entry of allScripts) {
      const r = await this.execute(entry.source);
      if (!r.success) errors.push(`[${entry.service}/${entry.name}] ${r.error}`);
    }
    this.scriptCount = allScripts.length;
    this.loadedProject = projectPath;
    return { loaded: allScripts, errors };
  }

  // ── Wave A: Observability ─────────────────────────────────────────────

  /**
   * Return all DataStore key-value pairs currently held in memory.
   * The DataStore shim in Lua stores data in `_datastores` table.
   * We approximate this by returning the snapshot we maintain.
   */
  getDataStoreSnapshot(): Record<string, Record<string, unknown>> {
    return this._dataStoreSnapshot;
  }

  /**
   * Build and return the full observability state payload.
   * Used by GET /api/observe/state and periodic WS push.
   * Note: Returns a plain object; caller imports and uses observability helpers directly.
   */
  getObserveStateRaw(): {
    instances: ReturnType<InstanceRegistry['getAll']>;
    physicsBodies: ReturnType<typeof physicsWorld.getSerializedBodies>;
    dataStore: Record<string, Record<string, unknown>>;
    players: Array<{ name: string; userId: number; health: number; position: [number, number, number] }>;
    metadata: { timestamp: number; tick: number; seed: number; deterministic: boolean };
  } {
    const instances = this.registry.getAll();
    const physicsBodies = physicsWorld.getSerializedBodies();
    const players = Array.from(liveState.players.values()).map(p => ({
      name: p.name,
      userId: 0,
      health: p.health,
      position: [p.position.x, p.position.y, p.position.z] as [number, number, number],
    }));

    return {
      instances,
      physicsBodies,
      dataStore: this._dataStoreSnapshot,
      players,
      metadata: {
        timestamp: Date.now(),
        tick: getPhysicsTick(),
        seed: this.seed,
        deterministic: this._deterministic,
      },
    };
  }

  // Wave 5: Full scene snapshot for /api/game/state/snapshot
  getSnapshotState(): object {
    const allInstances = this.registry.getAll();
    const PART_CLASSES = new Set(['Part', 'BasePart', 'MeshPart', 'WedgePart', 'SpecialMesh']);

    const parts = allInstances
      .filter(inst => PART_CLASSES.has(inst.ClassName) && inst.Name !== 'Baseplate')
      .map(inst => {
        const pos = inst.properties['Position'] as Record<string, number> | null;
        const size = inst.properties['Size'] as Record<string, number> | null;
        return {
          id: inst.id,
          name: inst.Name,
          position: pos ? { x: Number(pos['X'] ?? pos['x'] ?? 0), y: Number(pos['Y'] ?? pos['y'] ?? 0), z: Number(pos['Z'] ?? pos['z'] ?? 0) } : { x: 0, y: 0, z: 0 },
          size: size ? { x: Number(size['X'] ?? size['x'] ?? 4), y: Number(size['Y'] ?? size['y'] ?? 1), z: Number(size['Z'] ?? size['z'] ?? 4) } : { x: 4, y: 1, z: 4 },
          color: '#c0c0c0',
        };
      });

    const players = Array.from(liveState.players.values());
    const enemies = Array.from(liveState.enemies.values());

    return {
      parts,
      players,
      enemies,
      running: this.status === 'running',
    };
  }

  queryInstance(queryPath: string): any {
    const inst = this.registry.findByPath(queryPath);
    if (!inst) return { found: false, path: queryPath };
    return {
      found: true,
      Name: inst.Name,
      ClassName: inst.ClassName,
      Path: this.registry.getPath(inst.id),
      Properties: inst.properties,
      ChildCount: this.registry.getChildren(inst.id).length,
    };
  }

  getAllInstances(): any {
    // Return all instance records with id, ClassName, Name, properties
    return this.registry.getAll();
  }

  /**
   * Load an array of InstanceRecord objects into the registry.
   * Preserves parent-child relationships by mapping original IDs to new registry IDs.
   * @param instances Array of InstanceRecord objects to load
   * @param merge If true, add on top of current scene; if false, reset first
   */
  loadInstances(instances: InstanceRecord[], merge: boolean = false): void {
    if (!merge) {
      this.registry.reset();
    }

    // First pass: create all instances and build old-id -> new-id map
    const idMap = new Map<string, string>();
    for (const inst of instances) {
      const newId = this.registry.create(inst.ClassName, inst.Name);
      idMap.set(inst.id, newId);
    }

    // Second pass: set parents and properties using mapped IDs
    for (const inst of instances) {
      const newId = idMap.get(inst.id);
      if (!newId) continue;

      // Remap parentId
      if (inst.parentId !== null && inst.parentId !== undefined) {
        const newParentId = idMap.get(inst.parentId) ?? null;
        this.registry.setParent(newId, newParentId);
      }

      // Set properties
      for (const [key, value] of Object.entries(inst.properties)) {
        this.registry.setProperty(newId, key, value);
      }
    }
  }

  getGameState(): any {
    return {
      status: this.status,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      loadedProject: this.loadedProject,
      scriptCount: this.scriptCount,
      chatLog: this.chatLog,
      instanceCount: this.registry.getAll().length,
    };
  }

  // Backward compat
  getState(): GameState {
    return { status: this.status, startTime: this.startTime, players: [], parts: [], loadedProject: this.loadedProject, scriptCount: this.scriptCount };
  }
  getWorkspace() { return this.queryInstance('Workspace'); }
  createPart(name: string, pos?: any, size?: any) {
    return { Name: name, Position: pos || { x: 0, y: 0, z: 0 }, Size: size || { x: 4, y: 1, z: 4 } };
  }
  addStartupScript() {}
  getGame() { return {}; }

  // --- Wave 5: Test runner helpers ---
  async initialize(): Promise<void> {
    await this.initLua();
  }

  async executeRaw(code: string): Promise<any> {
    if (!this.engine) throw new Error('Engine not initialized');
    return await this.engine.doString(code);
  }

  cleanup(): void {
    if (this.engine) {
      try { this.engine.global.close(); } catch (_) {}
      this.engine = null;
    }
  }

  // --- Wave H: inject_lua — runs in existing global context without resetting ---
  async injectLua(code: string): Promise<{ injected: true; result: any }> {
    await this.initLua();
    try {
      const result = await this.engine!.doString(code);
      const output = await this.flushOutput();
      return { injected: true, result: result !== undefined ? result : output.join('\n') || null };
    } catch (err: any) {
      throw err;
    }
  }

  // --- Wave H: interrupt — forcefully reset the Lua VM ---
  async interruptExecution(): Promise<void> {
    if (this.engine) {
      try { this.engine.global.close(); } catch (_) {}
      this.engine = null;
    }
    // Re-initialize fresh VM
    await this.initLua();
    // Emit console:structured warning
    broadcastStructuredEvent({
      event: 'console:structured',
      level: 'warn',
      message: 'Execution interrupted',
      traceback: null,
      tick: getPhysicsTick(),
    });
  }

  // --- Wave H: hot-reload — re-execute script in existing context ---
  async hotReloadScript(file: string, code: string): Promise<{ reloaded: true; file: string; previous_hash: string; new_hash: string }> {
    await this.initLua();
    const { previous_hash, new_hash } = debugHotReload(file, code);

    // Execute in existing VM context
    try {
      await this.engine!.doString(code);
    } catch (err: any) {
      throw err;
    }

    // Emit console:structured warning
    broadcastStructuredEvent({
      event: 'console:structured',
      level: 'warn',
      message: `Hot-reloaded: ${file}`,
      traceback: null,
      tick: getPhysicsTick(),
    });

    return { reloaded: true, file, previous_hash, new_hash };
  }
}

// Wave H: buildStructuredError (needs GameEngine type, placed after class)
export function buildStructuredError(
  err: Error,
  engine: GameEngine,
  overrideType?: StructuredError['error_type'],
): StructuredError {
  const type = overrideType ?? classifyLuaError(err);
  const msg = err.message ?? String(err);
  const tracebackMatch = msg.match(/stack traceback:[\s\S]*/);
  const traceback = tracebackMatch ? tracebackMatch[0] : '';
  const cleanMsg = traceback ? msg.replace(traceback, '').trim() : msg;
  const raw = engine.getObserveStateRaw();

  return {
    error: true,
    error_type: type,
    message: cleanMsg,
    traceback,
    context_snapshot: {
      tick: raw.metadata.tick,
      seed: raw.metadata.seed,
      instance_count: raw.instances.length,
    },
    timestamp: Date.now(),
  };
}

export const gameEngine = new GameEngine();
