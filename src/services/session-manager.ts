/**
 * ClawBlox Session Manager — Wave C
 * Multi-Agent Session Orchestration: isolated Lua VM, physics world,
 * DataStore, trajectory recorder, and WebSocket namespace per session.
 */

import { randomUUID } from 'crypto';
import { LuaFactory, LuaEngine } from 'wasmoon';
import { WebSocket } from 'ws';
import { PhysicsWorld } from './physics-world.js';

// ---------------------------------------------------------------------------
// Re-export / inline minimal types we need without circular import
// ---------------------------------------------------------------------------

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

export interface MessageRecord {
  from: string;
  event: string;
  data: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Session shape
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  createdAt: number;
  label?: string;
  engine: SessionEngine;       // private Lua VM wrapper
  dataStore: Map<string, unknown>;
  trajectory: TrajectoryFrame[];
  deterministic: boolean;
  seed: number;
  wss: Set<WebSocket>;         // WS clients subscribed to this session
  messages: MessageRecord[];   // last 100 cross-session messages
  running: boolean;
}

export interface SessionSummary {
  session_id: string;
  label?: string;
  createdAt: number;
  running: boolean;
  instanceCount: number;
}

// ---------------------------------------------------------------------------
// Minimal instance registry (duplicated from game-engine, but isolated)
// ---------------------------------------------------------------------------

interface InstanceRecord {
  id: string;
  Name: string;
  ClassName: string;
  parentId: string | null;
  properties: Record<string, unknown>;
}

class SessionInstanceRegistry {
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

  setProperty(id: string, key: string, value: unknown) {
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

  count(): number {
    return this.instances.size;
  }
}

// ---------------------------------------------------------------------------
// SessionEngine — isolated wasmoon VM per session
// ---------------------------------------------------------------------------

export interface ScriptResult {
  success: boolean;
  returns?: unknown[];
  output?: string[];
  error?: string;
}

function buildSessionLuaSetup(): string {
  // Minimal Roblox shim for isolated sessions — same structure as game-engine.ts
  // but self-contained (no reference to global singletons).
  return `
-- ClawBlox Session Shim (Lua 5.4)

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

local function newInstance(className, name)
  local instName = name or className
  local id = _cb_create(className, instName)
  -- Use a proxy: _data holds actual values, inst is always empty so __newindex always fires
  local _data = {
    _id = id,
    Name = instName,
    ClassName = className,
    Parent = nil,
    _children = {},
  }
  local inst = {}
  setmetatable(inst, {
    __index = function(t, k)
      -- For physics-owned properties, read back from CANNON via JS bridge
      if k == "Velocity" or k == "Position" then
        local raw = _cb_getprop(id, k)
        if raw ~= nil then
          -- Convert JS object to a proper Lua table with X/Y/Z fields
          return Vector3.new(raw.X or 0, raw.Y or 0, raw.Z or 0)
        end
      end
      return _data[k]
    end,
    __newindex = function(t, k, v)
      _data[k] = v
      if k == "Name" then
        _cb_setprop(id, "Name", v)
      elseif k == "Parent" then
        local pid = v and v._id or nil
        _cb_setparent(id, pid)
        if v and v._children then
          table.insert(v._children, t)
        end
      else
        local serialized
        if type(v) == "boolean" then
          serialized = v
        elseif type(v) == "number" then
          serialized = v
        elseif type(v) == "table" then
          if v.X ~= nil and v.Y ~= nil and v.Z ~= nil then
            -- Vector3 — pass as table so physics callbacks get X/Y/Z numbers
            serialized = v
          elseif v.R ~= nil and v.G ~= nil and v.B ~= nil then
            serialized = "Color3(" .. tostring(v.R) .. "," .. tostring(v.G) .. "," .. tostring(v.B) .. ")"
          elseif v.EnumType ~= nil and v.Name ~= nil then
            serialized = "Enum." .. tostring(v.EnumType) .. "." .. tostring(v.Name)
          elseif v.Name ~= nil and type(v.Name) == "string" then
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
  function inst:WaitForChild(n) return self:FindFirstChild(n) end
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
  function inst:IsA(cn) return self.ClassName == cn end
  function inst:Destroy()
    _data["Parent"] = nil
    _cb_setparent(id, nil)
    _data["_children"] = {}
  end
  function inst:Clone() return newInstance(self.ClassName, self.Name) end
  function inst:_addChild(child)
    _data["Parent"] = self
    _cb_setparent(child._id, id)
    table.insert(self._children, child)
  end

  if className == "IntValue" or className == "NumberValue" then
    inst.Value = 0
  elseif className == "StringValue" then
    inst.Value = ""
  elseif className == "BoolValue" then
    inst.Value = false
  end
  return inst
end

local function makeService(className)
  return newInstance(className, className)
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
function Players:FindFirstChild(n) return _playersMap[n] end
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

local HttpService = makeService("HttpService")
function HttpService:JSONEncode(t) return tostring(t) end
function HttpService:JSONDecode(s) return {} end
function HttpService:GenerateGUID(_) return tostring(math.random(1e9)) end

local TweenService = makeService("TweenService")
function TweenService:Create(inst, tweenInfo, props)
  return {
    Play = function(self) for k, v in pairs(props) do inst[k] = v end end,
    Cancel = function() end,
    Pause = function() end,
    Completed = newEvent(),
  }
end

local _services = {
  Players = Players,
  Workspace = Workspace,
  ReplicatedStorage = ReplicatedStorage,
  ServerScriptService = ServerScriptService,
  RunService = RunService,
  DataStoreService = DataStoreService,
  HttpService = HttpService,
  TweenService = TweenService,
  Lighting = makeService("Lighting"),
  StarterPlayer = makeService("StarterPlayer"),
  PhysicsService = makeService("PhysicsService"),
  MessagingService = makeService("MessagingService"),
  PathfindingService = makeService("PathfindingService"),
  UserInputService = makeService("UserInputService"),
  SoundService = makeService("SoundService"),
  Chat = makeService("Chat"),
  Teams = makeService("Teams"),
  Debris = makeService("Debris"),
  CollectionService = makeService("CollectionService"),
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

task = {
  wait = function(n) return n or 0 end,
  spawn = function(fn, ...) pcall(fn, ...) end,
  delay = function(n, fn, ...) pcall(fn, ...) end,
  defer = function(fn, ...) pcall(fn, ...) end,
}
wait = function(n) return n or 0 end
delay = function(n, fn, ...) pcall(fn, ...) end
spawn = function(fn, ...) pcall(fn, ...) end

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

function _flushOutput()
  local out = {}
  for _, v in ipairs(_outBuf) do table.insert(out, v) end
  _outBuf = {}
  return out
end

-- ClawBlox Messaging receive hook (called by cross-session bridge)
ClawBloxMessaging = {
  _handlers = {},
  receive = function(event, data)
    local handler = ClawBloxMessaging._handlers[event]
    if handler then pcall(handler, data) end
  end,
  on = function(event, fn)
    ClawBloxMessaging._handlers[event] = fn
  end,
}

-- Math types (minimal subset)
local Vector3MT = {}
Vector3MT.__index = function(v, k)
  if k == "Magnitude" then return math.sqrt(v.X*v.X + v.Y*v.Y + v.Z*v.Z) end
end
Vector3MT.__add = function(a, b) return Vector3.new(a.X+b.X, a.Y+b.Y, a.Z+b.Z) end
Vector3MT.__sub = function(a, b) return Vector3.new(a.X-b.X, a.Y-b.Y, a.Z-b.Z) end
Vector3MT.__mul = function(a, b)
  if type(a) == "number" then return Vector3.new(a*b.X, a*b.Y, a*b.Z)
  elseif type(b) == "number" then return Vector3.new(a.X*b, a.Y*b, a.Z*b)
  else return Vector3.new(a.X*b.X, a.Y*b.Y, a.Z*b.Z) end
end
Vector3MT.__tostring = function(v) return "Vector3("..v.X..","..v.Y..","..v.Z..")" end
Vector3 = {
  new = function(x,y,z) return setmetatable({X=x or 0, Y=y or 0, Z=z or 0}, Vector3MT) end,
  zero = setmetatable({X=0,Y=0,Z=0}, Vector3MT),
  one  = setmetatable({X=1,Y=1,Z=1}, Vector3MT),
}
Vector2 = { new = function(x,y) return {X=x or 0,Y=y or 0} end }
Color3 = {
  new = function(r,g,b) return {R=r or 0,G=g or 0,B=b or 0} end,
  fromRGB = function(r,g,b) return {R=r/255,G=g/255,B=b/255} end,
}
BrickColor = { new = function(n) return {Name=n} end }
UDim2 = { new = function(sx,ox,sy,oy) return {ScaleX=sx,OffsetX=ox,ScaleY=sy,OffsetY=oy} end }
UDim  = { new = function(s,o) return {Scale=s,Offset=o} end }
CFrame = {
  new = function(x,y,z) return {X=x or 0,Y=y or 0,Z=z or 0,Position={X=x or 0,Y=y or 0,Z=z or 0}} end,
  Angles = function(rx,ry,rz) return {X=0,Y=0,Z=0,rx=rx or 0,ry=ry or 0,rz=rz or 0} end,
  identity = {X=0,Y=0,Z=0},
}
NumberSequence = { new = function(v) return {Value=v} end }
ColorSequence  = { new = function(v) return {Value=v} end }
Rect = { new = function(a,b,c,d) return {Min={X=a,Y=b},Max={X=c,Y=d}} end }

local _enumCache = {}
Enum = setmetatable({}, {
  __index = function(_, k)
    if not _enumCache[k] then
      local eg = {}
      _enumCache[k] = setmetatable({}, {
        __index = function(_, k2)
          if not eg[k2] then eg[k2] = {Name=k2, Value=0, EnumType=k} end
          return eg[k2]
        end
      })
    end
    return _enumCache[k]
  end
})

script = newInstance("Script", "Script")
tick   = function() return os.clock() end
time   = function() return os.clock() end
typeof = function(v) return type(v) end
assert = function(v, msg) if not v then error(msg or "assertion failed") end return v end
`;
}

export class SessionEngine {
  private luaEngine: LuaEngine | null = null;
  private factory: LuaFactory | null = null;
  private registry = new SessionInstanceRegistry();
  private _broadcast: ((type: string, msg: string) => void) | null = null;
  private physics = new PhysicsWorld();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_sessionId: string) {
    // sessionId is accepted for future use (e.g., labeling logs)
  }

  setBroadcast(fn: (type: string, msg: string) => void) {
    this._broadcast = fn;
  }

  private broadcast(type: string, msg: string) {
    if (this._broadcast) this._broadcast(type, msg);
  }

  async init(seed?: number): Promise<void> {
    if (this.luaEngine) return;
    this.factory = new LuaFactory();
    this.luaEngine = await this.factory.createEngine();

    this.luaEngine.global.set('_cb_create', (className: string, name: string): string => {
      const id = this.registry.create(className, name);
      // Register Parts in per-session physics world
      if (className === 'Part' || className === 'BasePart' || className === 'WedgePart' || className === 'MeshPart') {
        const inst = this.registry.get(id);
        if (inst) this.physics.registerPart(inst);
      }
      return id;
    });

    this.luaEngine.global.set('_cb_setparent', (id: string, parentId: string | null) => {
      this.registry.setParent(id, parentId);
    });

    this.luaEngine.global.set('_cb_setprop', (id: string, key: string, value: unknown) => {
      let storedValue = value;
      if (value !== null && value !== undefined && typeof value === 'object') {
        try {
          const v = value as Record<string, unknown>;
          const X = v['X'] ?? v['x'];
          const Y = v['Y'] ?? v['y'];
          const Z = v['Z'] ?? v['z'];
          if (X !== undefined || Y !== undefined || Z !== undefined) {
            storedValue = { X: Number(X ?? 0), Y: Number(Y ?? 0), Z: Number(Z ?? 0) };
          }
        } catch (_) {}
      }
      this.registry.setProperty(id, key, storedValue);

      // Sync physics for Part instances
      const inst = this.registry.get(id);
      if (inst && (inst.ClassName === 'Part' || inst.ClassName === 'BasePart' || inst.ClassName === 'WedgePart')) {
        if (key === 'Position' || key === 'Size') {
          this.physics.registerPart(inst); // registerPart is idempotent — syncs if already registered
          this.physics.syncPartPosition(inst);
        } else if (key === 'Velocity' && storedValue && typeof storedValue === 'object') {
          const sv = storedValue as Record<string, unknown>;
          this.physics.setVelocity(id, {
            x: Number(sv['X'] ?? 0),
            y: Number(sv['Y'] ?? 0),
            z: Number(sv['Z'] ?? 0),
          });
        } else if (key === 'Anchored') {
          this.physics.removePart(id);
          this.physics.registerPart(inst);
        }
      }
    });

    this.luaEngine.global.set('_cb_out', (type: string, msg: string) => {
      // Broadcast to subscribed WS clients for this session
      this.broadcast(type, msg);
    });

    // Read back physics-owned properties (Velocity, Position) from CANNON body
    // Returns a wasmoon-compatible table {X, Y, Z} or nil if not found.
    this.luaEngine.global.set('_cb_getprop', (id: string, key: string): unknown => {
      if (key === 'Velocity') {
        const v = this.physics.getVelocity(id);
        if (!v) return null;
        return { X: v.x, Y: v.y, Z: v.z };
      }
      if (key === 'Position') {
        const v = this.physics.getPosition(id);
        if (!v) return null;
        return { X: v.x, Y: v.y, Z: v.z };
      }
      return null;
    });

    // Wire per-session physics step
    this.luaEngine.global.set('_cb_physics_step', (dt: number) => {
      try {
        this.physics.step(dt);
        this.physics.syncAllPositions();
      } catch (e) {
        console.error('[SessionEngine] Physics step error:', e);
      }
    });

    // Roblox BasePart:ApplyImpulse(Vector3) shim — per-session
    this.luaEngine.global.set('_cb_impulse', (id: string, ix: number, iy: number, iz: number) => {
      this.physics.applyImpulse(id, { x: ix, y: iy, z: iz });
    });

    // Roblox BasePart:GetMass() shim — per-session
    this.luaEngine.global.set('_cb_getmass', (id: string): number => {
      return this.physics.getMass(id);
    });

    await this.luaEngine.doString(buildSessionLuaSetup());

    if (seed !== undefined) {
      await this.luaEngine.doString(`math.randomseed(${seed})`);
    }
  }

  async execute(code: string): Promise<ScriptResult> {
    if (!this.luaEngine) throw new Error('Engine not initialized');
    try {
      const wrapped = `
local __packed = table.pack(
  (function()
    ${code}
  end)()
)
local __out = {}
for i = 1, __packed.n do __out[i] = __packed[i] end
return __out
`;
      const result = await this.luaEngine.doString(wrapped);
      const output = await this.flushOutput();
      const returns: unknown[] = [];

      if (result !== undefined && result !== null && typeof result === 'object') {
        try {
          const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
          for (const v of arr) {
            if (v === undefined) continue;
            if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
              returns.push(v);
            } else if (v !== null && typeof v === 'object') {
              try { returns.push(JSON.parse(JSON.stringify(v))); } catch { returns.push(String(v)); }
            } else {
              returns.push(String(v));
            }
          }
        } catch { returns.push(String(result)); }
      } else if (result !== undefined && result !== null) {
        returns.push(result);
      }

      return { success: true, returns, output };
    } catch (err: unknown) {
      const output = await this.flushOutput();
      return { success: false, error: (err as Error).message, output };
    }
  }

  /** Step the per-session physics world by dt seconds and sync positions back to registry. */
  physicsStep(dt: number): void {
    this.physics.step(dt);
    this.physics.syncAllPositions();
  }

  /** Teleport a Part to pos and zero its velocity (clean episode reset). */
  resetPart(instanceId: string, pos: { x: number; y: number; z: number }): void {
    this.physics.resetPart(instanceId, pos);
  }

  /** Deliver a cross-session message — sets a global then calls receive */
  async deliverMessageWithData(event: string, data: unknown): Promise<void> {
    if (!this.luaEngine) return;
    // Escape event name for Lua string literal
    const escapedEvent = event.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    try {
      // Set data as a JS global accessible from Lua
      this.luaEngine.global.set('_session_msg_data', data ?? null);
      await this.luaEngine.doString(`ClawBloxMessaging.receive("${escapedEvent}", _session_msg_data)`);
    } catch (_) {}
  }

  private async flushOutput(): Promise<string[]> {
    try {
      const result = await this.luaEngine!.doString('return table.concat(_flushOutput(), "\\n")');
      if (typeof result === 'string' && result.length > 0) return result.split('\n');
      return [];
    } catch (_) { return []; }
  }

  getInstanceCount(): number {
    return this.registry.count();
  }

  getObserveState(): { instances: InstanceRecord[]; metadata: { timestamp: number; seed: number; deterministic: boolean } } {
    return {
      instances: this.registry.getAll(),
      metadata: {
        timestamp: Date.now(),
        seed: 0,
        deterministic: false,
      },
    };
  }

  reset(): void {
    if (this.luaEngine) {
      try { this.luaEngine.global.close(); } catch (_) {}
      this.luaEngine = null;
    }
    this.registry.reset();
    this.physics = new PhysicsWorld();
  }

  destroy(): void {
    this.reset();
  }
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

const MAX_SESSIONS = 64;
const MAX_MESSAGES_PER_SESSION = 100;

class SessionManager {
  private sessions: Map<string, Session> = new Map();

  /** Create a new isolated session. Returns 429 error string if at cap. */
  createSession(options?: { label?: string; seed?: number; deterministic?: boolean }): Session | { error: string; code: 429 } {
    if (this.sessions.size >= MAX_SESSIONS) {
      return { error: 'Session limit reached (max 64)', code: 429 };
    }

    const id = randomUUID();
    const seed = options?.seed ?? Math.floor(Math.random() * 2 ** 31);
    const deterministic = options?.deterministic ?? false;

    const engine = new SessionEngine(id);

    const session: Session = {
      id,
      createdAt: Date.now(),
      label: options?.label,
      engine,
      dataStore: new Map(),
      trajectory: [],
      deterministic,
      seed,
      wss: new Set(),
      messages: [],
      running: false,
    };

    this.sessions.set(id, session);

    // Initialize the engine asynchronously — callers should await start/init
    engine.init(deterministic ? seed : undefined).then(() => {
      // Wire session-scoped WS broadcast
      engine.setBroadcast((type: string, msg: string) => {
        this.broadcastToSession(id, type, msg);
      });
    }).catch(err => {
      console.error(`[SessionManager] Engine init error for session ${id}:`, err);
    });

    return session;
  }

  /** Ensure a session's engine is initialized (idempotent). */
  async ensureInit(session: Session): Promise<void> {
    await session.engine.init(session.deterministic ? session.seed : undefined);
    // Wire broadcast after init
    session.engine.setBroadcast((type: string, msg: string) => {
      this.broadcastToSession(session.id, type, msg);
    });
  }

  getSession(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values()).map(s => ({
      session_id: s.id,
      label: s.label,
      createdAt: s.createdAt,
      running: s.running,
      instanceCount: s.engine.getInstanceCount(),
    }));
  }

  destroySession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.engine.destroy();
    // Close all subscribed WS connections gracefully
    for (const ws of session.wss) {
      try {
        ws.send(JSON.stringify({ type: 'session_destroyed', session_id: id }));
      } catch (_) {}
    }
    session.wss.clear();
    this.sessions.delete(id);
    return true;
  }

  destroyAllSessions(): number {
    const count = this.sessions.size;
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
    return count;
  }

  /** Reset a session's engine + trajectory, keeping same id/seed/label. */
  async resetSession(session: Session): Promise<void> {
    session.engine.reset();
    session.trajectory = [];
    session.messages = [];
    session.running = false;
    await session.engine.init(session.deterministic ? session.seed : undefined);
    session.engine.setBroadcast((type: string, msg: string) => {
      this.broadcastToSession(session.id, type, msg);
    });
  }

  /** Subscribe a WebSocket client to a session. */
  subscribeClient(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (session) session.wss.add(ws);
  }

  /** Unsubscribe a WebSocket client from all sessions. */
  unsubscribeClient(ws: WebSocket): void {
    for (const session of this.sessions.values()) {
      session.wss.delete(ws);
    }
  }

  /** Broadcast a message to all WS clients subscribed to a session. */
  broadcastToSession(sessionId: string, type: string, message: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const payload = JSON.stringify({ type, message, session_id: sessionId, timestamp: new Date().toISOString() });
    for (const ws of session.wss) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      } catch (_) {}
    }
  }

  /** Add a message to a session's queue (capped at 100). */
  enqueueMessage(session: Session, record: MessageRecord): void {
    session.messages.push(record);
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages.shift();
    }
  }
}

export const sessionManager = new SessionManager();
