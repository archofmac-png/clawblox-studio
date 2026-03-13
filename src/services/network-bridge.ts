/**
 * ClawBlox NetworkBridge — Wave 4
 * Manages server VM + per-player client VMs.
 * Routes RemoteEvent:FireClient / FireServer between them.
 */

import { LuaFactory, LuaEngine } from 'wasmoon';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------
export interface ClientOutput {
  playerName: string;
  type: string;
  message: string;
  timestamp: string;
}

export type BroadcastFn = (type: string, message: string) => void;

/** Stored RemoteEvent handler registration */
interface RemoteHandler {
  /** The Lua callback (stored as JS reference or called via engine) */
  luaCallback?: unknown;
  /** Pending invocations queued before handler was connected */
  queue: Array<{ args: unknown[] }>;
}

// -------------------------------------------------------------------
// Minimal Lua shim for client VMs
// -------------------------------------------------------------------
const CLIENT_VM_SHIM = `
-- ClawBlox Client VM Shim
-- Lightweight Lua environment for client-side scripts

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

-- Output buffer (routed back to server via JS callback)
local _clientOut = {}
print = function(...)
  local parts = {}
  for i = 1, select("#", ...) do table.insert(parts, tostring(select(i, ...))) end
  local msg = table.concat(parts, "\\t")
  table.insert(_clientOut, msg)
  if _cb_client_out then _cb_client_out("print", msg) end
end
warn = function(...)
  local parts = {"[WARN]"}
  for i = 1, select("#", ...) do table.insert(parts, tostring(select(i, ...))) end
  local msg = table.concat(parts, "\\t")
  table.insert(_clientOut, msg)
  if _cb_client_out then _cb_client_out("warn", msg) end
end

-- RemoteEvent registry for client
local _clientRemotes = {}

-- Get or create a remote event on the client side
function _getClientRemote(name)
  if not _clientRemotes[name] then
    local remote = {}
    remote.Name = name
    remote.OnClientEvent = newEvent()
    _clientRemotes[name] = remote
  end
  return _clientRemotes[name]
end

-- Fire a client remote (called from JS when server fires to this client)
function _fireClientRemote(name, ...)
  local remote = _clientRemotes[name]
  if remote and remote.OnClientEvent then
    remote.OnClientEvent:Fire(...)
  end
end

-- Flush output buffer
function _flushClientOutput()
  local out = {}
  for _, v in ipairs(_clientOut) do table.insert(out, v) end
  _clientOut = {}
  return out
end

-- Stub globals
Vector3 = { new = function(x,y,z) return {X=x or 0,Y=y or 0,Z=z or 0} end }
Vector2 = { new = function(x,y) return {X=x or 0,Y=y or 0} end }
task = {
  wait = function(n) return n or 0 end,
  spawn = function(fn, ...) pcall(fn, ...) end,
  delay = function(n, fn, ...) pcall(fn, ...) end,
  defer = function(fn, ...) pcall(fn, ...) end,
}
wait = function(n) return n or 0 end
tick = function() return os.clock() end
`;

// -------------------------------------------------------------------
// ClientVM wrapper
// -------------------------------------------------------------------
class ClientVM {
  public playerName: string;
  private engine: LuaEngine | null = null;
  private factory: LuaFactory;
  private onOutput?: (out: ClientOutput) => void;
  public output: string[] = [];

  constructor(playerName: string, factory: LuaFactory, onOutput?: (out: ClientOutput) => void) {
    this.playerName = playerName;
    this.factory = factory;
    this.onOutput = onOutput;
  }

  async initialize(): Promise<void> {
    this.engine = await this.factory.createEngine();

    // Route client print/warn to parent
    this.engine.global.set('_cb_client_out', (type: string, msg: string) => {
      const prefixed = `[CLIENT:${this.playerName}] ${msg}`;
      this.output.push(prefixed);
      if (this.onOutput) {
        this.onOutput({
          playerName: this.playerName,
          type,
          message: prefixed,
          timestamp: new Date().toISOString(),
        });
      }
    });

    await this.engine.doString(CLIENT_VM_SHIM);
  }

  async execute(code: string): Promise<{ output: string[]; result: unknown; error?: string }> {
    if (!this.engine) throw new Error('Client VM not initialized');
    const prevOutputLen = this.output.length;
    try {
      const result = await this.engine.doString(code);
      const newOutput = this.output.slice(prevOutputLen);
      return { output: newOutput, result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: this.output.slice(prevOutputLen), result: null, error: msg };
    }
  }

  /**
   * Fire a RemoteEvent on this client VM.
   * Calls _fireClientRemote(name, ...) in Lua.
   */
  async fireRemote(remoteName: string, args: unknown[]): Promise<void> {
    if (!this.engine) return;

    // Build a Lua call: _fireClientRemote("name", arg1, arg2, ...)
    const argStr = args.map(a => {
      if (typeof a === 'string') return JSON.stringify(a);
      if (typeof a === 'number' || typeof a === 'boolean') return String(a);
      return JSON.stringify(a);
    }).join(', ');

    try {
      await this.engine.doString(`_fireClientRemote(${JSON.stringify(remoteName)}, ${argStr})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[NetworkBridge] fireRemote error on ${this.playerName}:`, msg);
    }
  }

  destroy(): void {
    if (this.engine) {
      try { this.engine.global.close(); } catch (_) {}
      this.engine = null;
    }
  }
}

// -------------------------------------------------------------------
// NetworkBridge
// -------------------------------------------------------------------
export class NetworkBridge {
  /** Per-player client VMs */
  private clientVMs: Map<string, ClientVM> = new Map();
  /** Shared LuaFactory — reuse for all client VMs */
  private factory: LuaFactory = new LuaFactory();
  /** Broadcast function to push client output to WebSocket */
  private broadcast?: BroadcastFn;
  /** Registered server-side OnServerEvent handlers: remoteName → callbacks */
  private serverHandlers: Map<string, Array<(player: string, ...args: unknown[]) => void>> = new Map();

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  /**
   * Spin up a new client VM for a player.
   */
  async addClient(playerName: string): Promise<void> {
    if (this.clientVMs.has(playerName)) return; // Already exists

    const vm = new ClientVM(playerName, this.factory, (out) => {
      // Route client output to WebSocket with [CLIENT:name] prefix
      if (this.broadcast) {
        this.broadcast(out.type, out.message);
      }
    });

    await vm.initialize();
    this.clientVMs.set(playerName, vm);
    console.log(`[NetworkBridge] Client VM added for player: ${playerName}`);
  }

  /**
   * Remove a client VM for a player.
   */
  removeClient(playerName: string): void {
    const vm = this.clientVMs.get(playerName);
    if (vm) {
      vm.destroy();
      this.clientVMs.delete(playerName);
      console.log(`[NetworkBridge] Client VM removed for player: ${playerName}`);
    }
  }

  /**
   * Route a FireServer call from client → server.
   * Calls registered OnServerEvent handlers.
   */
  async fireServer(playerName: string, remoteName: string, args: unknown[]): Promise<void> {
    const handlers = this.serverHandlers.get(remoteName) ?? [];
    for (const handler of handlers) {
      try {
        handler(playerName, ...args);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[NetworkBridge] fireServer handler error for ${remoteName}:`, msg);
      }
    }

    if (handlers.length === 0) {
      console.log(`[NetworkBridge] FireServer: ${remoteName} from ${playerName} (no handlers registered)`);
    }
  }

  /**
   * Route a FireClient call from server → specific client VM.
   */
  async fireClient(playerName: string, remoteName: string, args: unknown[]): Promise<void> {
    const vm = this.clientVMs.get(playerName);
    if (!vm) {
      console.warn(`[NetworkBridge] fireClient: no client VM for player ${playerName}`);
      return;
    }
    await vm.fireRemote(remoteName, args);
  }

  /**
   * Fire to all connected client VMs.
   */
  async fireAllClients(remoteName: string, args: unknown[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [, vm] of this.clientVMs) {
      promises.push(vm.fireRemote(remoteName, args));
    }
    await Promise.all(promises);
  }

  /**
   * Register a server-side OnServerEvent handler for a RemoteEvent.
   */
  onServerEvent(remoteName: string, handler: (player: string, ...args: unknown[]) => void): void {
    if (!this.serverHandlers.has(remoteName)) {
      this.serverHandlers.set(remoteName, []);
    }
    this.serverHandlers.get(remoteName)!.push(handler);
  }

  /**
   * Run a Lua script on a specific client VM.
   */
  async runOnClient(
    playerName: string,
    code: string
  ): Promise<{ output: string[]; result: unknown; error?: string }> {
    const vm = this.clientVMs.get(playerName);
    if (!vm) throw new Error(`No client VM for player: ${playerName}`);
    return await vm.execute(code);
  }

  /** List all connected client player names */
  getClients(): string[] {
    return Array.from(this.clientVMs.keys());
  }

  getClientCount(): number {
    return this.clientVMs.size;
  }

  getClientOutput(playerName: string): string[] {
    return this.clientVMs.get(playerName)?.output ?? [];
  }
}

// Singleton export
export const networkBridge = new NetworkBridge();
