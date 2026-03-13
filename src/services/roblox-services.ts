/**
 * Roblox Services - Enhanced Mock Implementation
 *
 * Provides mock implementations of essential Roblox services:
 * - game (root object)
 * - Players (with AddPlayer, RemovePlayer, leaderstats, Character)
 * - Workspace (FindFirstChild, GetChildren, GetDescendants, FindFirstChildOfClass)
 * - ReplicatedStorage (FindFirstChild, WaitForChild)
 * - CollectionService (GetTagged, AddTag, HasTag)
 * - RunService (IsServer, IsClient, Heartbeat event)
 * - Full Instance base (Name, ClassName, Parent, Children, Destroy, Clone)
 * - Part (Position, Size, Anchored, CanCollide, BrickColor)
 * - Event system (Connect, Fire, Wait)
 */

// -----------------------------------------------------------------------------
// Event System
// -----------------------------------------------------------------------------

export interface RBXScriptConnection {
  Connected: boolean;
  Disconnect(): void;
}

export class RBXScriptSignal {
  private callbacks: Array<(...args: any[]) => void> = [];

  Connect(callback: (...args: any[]) => void): RBXScriptConnection {
    this.callbacks.push(callback);
    const conn: RBXScriptConnection = {
      Connected: true,
      Disconnect: () => {
        this.callbacks = this.callbacks.filter(c => c !== callback);
        conn.Connected = false;
      },
    };
    return conn;
  }

  Fire(...args: any[]): void {
    for (const cb of this.callbacks) {
      try { cb(...args); } catch (_) {}
    }
  }

  /** Synchronous mock Wait – fires with undefined args immediately */
  Wait(): any[] {
    return [];
  }
}

// -----------------------------------------------------------------------------
// Instance Interfaces
// -----------------------------------------------------------------------------

export interface Instance {
  Name: string;
  ClassName: string;
  Parent?: Instance;
  Children: Instance[];
  Properties: Map<string, any>;

  FindFirstChild(name: string): Instance | undefined;
  FindFirstChildOfClass(className: string): Instance | undefined;
  GetChildren(): Instance[];
  GetDescendants(): Instance[];
  GetFullName(): string;
  Destroy(): void;
  Clone(): Instance;
}

export interface Player extends Instance {
  UserId: number;
  DisplayName: string;
  Character?: Instance;
  Leaderstats?: Instance;
  Data: Map<string, any>;
}

export interface Part extends Instance {
  Position: { x: number; y: number; z: number };
  Size: { x: number; y: number; z: number };
  CFrame: any;
  Anchored: boolean;
  CanCollide: boolean;
  BrickColor: string;
}

// -----------------------------------------------------------------------------
// Base Instance Class
// -----------------------------------------------------------------------------

export class BaseInstance implements Instance {
  Name: string;
  ClassName: string;
  Parent?: Instance;
  Children: Instance[] = [];
  Properties: Map<string, any> = new Map();

  constructor(className: string, name: string) {
    this.ClassName = className;
    this.Name = name;
  }

  FindFirstChild(name: string): Instance | undefined {
    return this.Children.find(c => c.Name === name);
  }

  FindFirstChildOfClass(className: string): Instance | undefined {
    return this.Children.find(c => c.ClassName === className);
  }

  GetChildren(): Instance[] {
    return [...this.Children];
  }

  GetDescendants(): Instance[] {
    const result: Instance[] = [];
    for (const child of this.Children) {
      result.push(child);
      result.push(...child.GetDescendants());
    }
    return result;
  }

  GetFullName(): string {
    if (!this.Parent) return this.Name;
    return `${this.Parent.GetFullName()}.${this.Name}`;
  }

  Destroy(): void {
    if (this.Parent) {
      this.Parent.Children = this.Parent.Children.filter(c => c !== this);
    }
    this.Children = [];
    this.Parent = undefined;
  }

  Clone(): Instance {
    const cloned = new BaseInstance(this.ClassName, this.Name);
    cloned.Properties = new Map(this.Properties);
    for (const child of this.Children) {
      const childClone = child.Clone();
      childClone.Parent = cloned;
      cloned.Children.push(childClone);
    }
    return cloned;
  }

  /** Add child and set its Parent */
  addChild(child: Instance): void {
    child.Parent = this;
    this.Children.push(child);
  }

  toJSON(): any {
    return {
      Name: this.Name,
      ClassName: this.ClassName,
      Children: this.Children.map((c: any) => c.toJSON ? c.toJSON() : { Name: c.Name, ClassName: c.ClassName }),
    };
  }
}

// -----------------------------------------------------------------------------
// Player Class
// -----------------------------------------------------------------------------

class PlayerClass extends BaseInstance implements Player {
  UserId: number;
  DisplayName: string;
  Character?: Instance;
  Leaderstats?: Instance;
  Data: Map<string, any> = new Map();

  constructor(name: string, userId: number) {
    super('Player', name);
    this.DisplayName = name;
    this.UserId = userId;

    // Create a Character model
    const char = new BaseInstance('Model', name);
    this.Character = char;

    // Create leaderstats folder
    const leaderstats = new BaseInstance('Folder', 'leaderstats');
    this.Leaderstats = leaderstats;
    this.addChild(leaderstats);
  }

  toJSON(): any {
    return {
      Name: this.Name,
      ClassName: this.ClassName,
      UserId: this.UserId,
      DisplayName: this.DisplayName,
      HasCharacter: !!this.Character,
      leaderstats: this.Leaderstats
        ? (this.Leaderstats as any).Children.map((c: any) => ({
            Name: c.Name,
            Value: c.Properties.get('Value'),
          }))
        : [],
    };
  }
}

// -----------------------------------------------------------------------------
// Part Class
// -----------------------------------------------------------------------------

export class PartClass extends BaseInstance implements Part {
  Position = { x: 0, y: 0, z: 0 };
  Size = { x: 4, y: 1, z: 4 };
  Anchored = true;
  CanCollide = true;
  BrickColor = 'Medium stone grey';
  CFrame: any = null;

  constructor(name: string) {
    super('Part', name);
  }

  Clone(): Instance {
    const cloned = new PartClass(this.Name);
    cloned.Position = { ...this.Position };
    cloned.Size = { ...this.Size };
    cloned.Anchored = this.Anchored;
    cloned.CanCollide = this.CanCollide;
    cloned.BrickColor = this.BrickColor;
    cloned.Properties = new Map(this.Properties);
    return cloned;
  }

  toJSON(): any {
    return {
      Name: this.Name,
      ClassName: this.ClassName,
      Position: this.Position,
      Size: this.Size,
      Anchored: this.Anchored,
      CanCollide: this.CanCollide,
      BrickColor: this.BrickColor,
    };
  }
}

// -----------------------------------------------------------------------------
// Players Service
// -----------------------------------------------------------------------------

class PlayersService extends BaseInstance {
  LocalPlayer?: Player;
  private players: Map<number, Player> = new Map();
  private nextUserId = 1;

  /** Events */
  PlayerAdded = new RBXScriptSignal();
  PlayerRemoving = new RBXScriptSignal();

  constructor() {
    super('Players', 'Players');
  }

  /** Add a player by name (auto-assigns UserId) */
  AddPlayer(name: string): Player {
    const userId = this.nextUserId++;
    return this.CreatePlayer(name, userId);
  }

  /** Remove a player by name */
  RemovePlayer(name: string): boolean {
    const player = Array.from(this.players.values()).find(p => p.Name === name);
    if (!player) return false;
    this.PlayerRemoving.Fire(player);
    this.players.delete(player.UserId);
    this.Children = this.Children.filter(c => c !== player);
    return true;
  }

  CreatePlayer(name: string, userId: number): Player {
    const player = new PlayerClass(name, userId);
    player.Parent = this;
    this.players.set(userId, player);
    this.Children.push(player);
    this.PlayerAdded.Fire(player);
    return player;
  }

  GetPlayerByUserId(userId: number): Player | undefined {
    return this.players.get(userId);
  }

  GetPlayerByName(name: string): Player | undefined {
    return Array.from(this.players.values()).find(p => p.Name === name);
  }

  GetPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  toJSON(): any {
    return {
      ClassName: 'Players',
      playerCount: this.players.size,
      players: Array.from(this.players.values()).map(p => (p as any).toJSON()),
    };
  }
}

// -----------------------------------------------------------------------------
// Workspace Service
// -----------------------------------------------------------------------------

class WorkspaceService extends BaseInstance {
  private parts: Map<string, Part> = new Map();

  constructor() {
    super('Workspace', 'Workspace');
    // Add default Baseplate
    this.CreatePart('Baseplate', { x: 0, y: -0.5, z: 0 }, { x: 512, y: 1, z: 512 });
  }

  CreatePart(
    name: string,
    position?: { x: number; y: number; z: number },
    size?: { x: number; y: number; z: number },
  ): Part {
    const part = new PartClass(name);
    if (position) part.Position = position;
    if (size) part.Size = size;
    part.Parent = this;
    this.parts.set(name, part);
    this.Children.push(part);
    return part;
  }

  GetPart(name: string): Part | undefined {
    return this.parts.get(name);
  }

  GetParts(): Part[] {
    return Array.from(this.parts.values());
  }

  FindPartsInRegion(_region: any): Part[] {
    return this.GetParts();
  }

  toJSON(): any {
    return {
      ClassName: 'Workspace',
      partCount: this.parts.size,
      children: this.Children.map(c => (c as any).toJSON ? (c as any).toJSON() : { Name: c.Name, ClassName: c.ClassName }),
    };
  }
}

// -----------------------------------------------------------------------------
// ReplicatedStorage Service
// -----------------------------------------------------------------------------

class ReplicatedStorageService extends BaseInstance {
  private storage: Map<string, Instance> = new Map();
  private waiters: Map<string, Array<(inst: Instance) => void>> = new Map();

  constructor() {
    super('ReplicatedStorage', 'ReplicatedStorage');
  }

  CreateInstance(className: string, name: string): Instance {
    const instance = new BaseInstance(className, name);
    instance.Parent = this;
    this.storage.set(name, instance);
    this.Children.push(instance);
    // Notify any WaitForChild waiters
    const waitList = this.waiters.get(name);
    if (waitList) {
      for (const resolve of waitList) resolve(instance);
      this.waiters.delete(name);
    }
    return instance;
  }

  GetInstance(name: string): Instance | undefined {
    return this.storage.get(name);
  }

  /** Synchronous mock: returns immediately if exists, otherwise undefined */
  WaitForChild(name: string, _timeout?: number): Instance | undefined {
    return this.storage.get(name) ?? this.FindFirstChild(name);
  }

  toJSON(): any {
    return {
      ClassName: 'ReplicatedStorage',
      instanceCount: this.storage.size,
      children: this.Children.map(c => ({ Name: c.Name, ClassName: c.ClassName })),
    };
  }
}

// -----------------------------------------------------------------------------
// CollectionService
// -----------------------------------------------------------------------------

class CollectionServiceClass extends BaseInstance {
  private tags: Map<string, Set<Instance>> = new Map();

  constructor() {
    super('CollectionService', 'CollectionService');
  }

  AddTag(instance: Instance, tag: string): void {
    if (!this.tags.has(tag)) this.tags.set(tag, new Set());
    this.tags.get(tag)!.add(instance);
  }

  RemoveTag(instance: Instance, tag: string): void {
    this.tags.get(tag)?.delete(instance);
  }

  GetTagged(tag: string): Instance[] {
    return this.tags.has(tag) ? Array.from(this.tags.get(tag)!) : [];
  }

  HasTag(instance: Instance, tag: string): boolean {
    return this.tags.get(tag)?.has(instance) ?? false;
  }

  GetAllTags(): string[] {
    return Array.from(this.tags.keys());
  }
}

// -----------------------------------------------------------------------------
// RunService
// -----------------------------------------------------------------------------

class RunServiceClass extends BaseInstance {
  private _isRunning = false;
  private _isServer = true;
  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  Heartbeat = new RBXScriptSignal();
  Stepped = new RBXScriptSignal();

  constructor() {
    super('RunService', 'RunService');
  }

  IsServer(): boolean { return this._isServer; }
  IsClient(): boolean { return !this._isServer; }
  IsRunning(): boolean { return this._isRunning; }

  Start(): void {
    this._isRunning = true;
    let lastTime = Date.now();
    this._heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      this.Heartbeat.Fire(dt);
      this.Stepped.Fire(0, dt);
    }, 100); // ~10 Hz mock heartbeat
  }

  Stop(): void {
    this._isRunning = false;
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }
}

// -----------------------------------------------------------------------------
// ContextActionService (stub)
// -----------------------------------------------------------------------------

class ContextActionServiceClass extends BaseInstance {
  constructor() { super('ContextActionService', 'ContextActionService'); }
  BindAction(_name: string, _callback: any, _create: boolean, ..._keys: any[]) {}
  UnbindAction(_name: string) {}
}

// -----------------------------------------------------------------------------
// Game Object (root)
// -----------------------------------------------------------------------------

class Game {
  private services: Map<string, any> = new Map();

  public Players: PlayersService;
  public Workspace: WorkspaceService;
  public ReplicatedStorage: ReplicatedStorageService;
  public CollectionService: CollectionServiceClass;
  public RunService: RunServiceClass;
  public ContextActionService: ContextActionServiceClass;

  constructor() {
    this.Players = new PlayersService();
    this.Workspace = new WorkspaceService();
    this.ReplicatedStorage = new ReplicatedStorageService();
    this.CollectionService = new CollectionServiceClass();
    this.RunService = new RunServiceClass();
    this.ContextActionService = new ContextActionServiceClass();

    this.services.set('Players', this.Players);
    this.services.set('Workspace', this.Workspace);
    this.services.set('ReplicatedStorage', this.ReplicatedStorage);
    this.services.set('CollectionService', this.CollectionService);
    this.services.set('RunService', this.RunService);
    this.services.set('ContextActionService', this.ContextActionService);
    // Common aliases
    this.services.set('ServerScriptService', new BaseInstance('ServerScriptService', 'ServerScriptService'));
    this.services.set('StarterPlayer', new BaseInstance('StarterPlayer', 'StarterPlayer'));
    this.services.set('StarterGui', new BaseInstance('StarterGui', 'StarterGui'));
    this.services.set('Lighting', new BaseInstance('Lighting', 'Lighting'));
    this.services.set('SoundService', new BaseInstance('SoundService', 'SoundService'));
    this.services.set('Debris', new BaseInstance('Debris', 'Debris'));
    this.services.set('TweenService', new BaseInstance('TweenService', 'TweenService'));
    this.services.set('UserInputService', new BaseInstance('UserInputService', 'UserInputService'));
    this.services.set('MarketplaceService', new BaseInstance('MarketplaceService', 'MarketplaceService'));
    this.services.set('DataStoreService', new BaseInstance('DataStoreService', 'DataStoreService'));
    this.services.set('HttpService', new BaseInstance('HttpService', 'HttpService'));
    this.services.set('TeleportService', new BaseInstance('TeleportService', 'TeleportService'));
    this.services.set('Teams', new BaseInstance('Teams', 'Teams'));
    this.services.set('Chat', new BaseInstance('Chat', 'Chat'));
  }

  GetService(serviceName: string): any {
    const svc = this.services.get(serviceName);
    if (!svc) throw new Error(`Service not found: ${serviceName}`);
    return svc;
  }

  reset(): void {
    // Re-initialize all services for a fresh game
    this.Players = new PlayersService();
    this.Workspace = new WorkspaceService();
    this.ReplicatedStorage = new ReplicatedStorageService();
    this.CollectionService = new CollectionServiceClass();
    this.RunService = new RunServiceClass();
    this.services.set('Players', this.Players);
    this.services.set('Workspace', this.Workspace);
    this.services.set('ReplicatedStorage', this.ReplicatedStorage);
    this.services.set('CollectionService', this.CollectionService);
    this.services.set('RunService', this.RunService);
  }

  toJSON(): any {
    return {
      Players: this.Players.toJSON(),
      Workspace: this.Workspace.toJSON(),
      ReplicatedStorage: this.ReplicatedStorage.toJSON(),
    };
  }
}

// -----------------------------------------------------------------------------
// Singleton game instance
// -----------------------------------------------------------------------------

export const game = new Game();

// -----------------------------------------------------------------------------
// Lua Bindings
// -----------------------------------------------------------------------------

export function createLuaGlobals() {
  return {
    game: {
      GetService: (name: string) => game.GetService(name),
      Players: game.Players,
      Workspace: game.Workspace,
      ReplicatedStorage: game.ReplicatedStorage,
      CollectionService: game.CollectionService,
      RunService: game.RunService,
    },
  };
}
