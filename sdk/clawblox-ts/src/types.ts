// ClawBlox Studio API Type Definitions

export interface Vector3 {
  X: number;
  Y: number;
  Z: number;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export interface GameStartOptions {
  deterministic?: boolean;
  seed?: number;
}

export interface GameStartResponse {
  success: boolean;
  status: string;
  message?: string;
  seed?: number;
  deterministic?: boolean;
}

export interface GameStopResponse {
  success: boolean;
  status: string;
  message: string;
}

export interface ExecuteRequest {
  script: string;
}

export interface ExecuteResponse {
  success: boolean;
  output?: string;
  error?: string;
}

export interface GameState {
  status: string;
  tick?: number;
}

export interface InstanceInfo {
  id: string;
  Name: string;
  ClassName: string;
  Path?: string;
  ChildCount?: number;
  Properties?: Record<string, unknown>;
}

export interface InstancesResponse {
  instances: InstanceInfo[];
}

export interface QueryResponse {
  found: boolean;
  path?: string;
  Name?: string;
  ClassName?: string;
}

export interface TestRequest {
  assertion: string;
  description?: string;
}

export interface TestResponse {
  passed: boolean;
  description?: string;
  error?: string;
}

export interface LoadRequest {
  projectId?: string;
  projectPath?: string;
}

export interface LoadResponse {
  success: boolean;
  projectPath?: string;
  scriptsLoaded?: number;
  scripts?: Array<{ name: string; service: string; path: string }>;
  errors?: string[];
}

export interface SimulateRequest {
  playerName: string;
  action: 'join' | 'leave' | 'chat' | 'move';
  message?: string;
  position?: Vector3;
}

export interface WorkspaceResponse {
  children: unknown[];
}

export interface CreatePartRequest {
  name: string;
  position?: Vector3;
  size?: Vector3;
}

export interface CreatePartResponse {
  success: boolean;
  part?: {
    Name: string;
    ClassName: string;
  };
}

export interface TestRunRequest {
  filePath?: string;
  code?: string;
}

export interface TestRunResponse {
  tests?: Array<{ name: string; passed: boolean; error?: string }>;
  passed?: number;
  failed?: number;
  error?: string;
}

export interface TestFilesResponse {
  files: string[];
}

export interface SphereCastRequest {
  origin: Vector3;
  direction: Vector3;
  radius: number;
  distance: number;
}

export interface SphereCastResponse {
  hits: Array<{ name: string; className: string; position: Vector3 }>;
}

export interface PhysicsStepRequest {
  dt?: number;
}

export interface PhysicsStepResponse {
  ok: boolean;
  dt: number;
}

export interface PhysicsBodiesResponse {
  count: number;
  bodies: unknown[];
}

export interface AddClientRequest {
  playerName: string;
}

export interface AddClientResponse {
  ok: boolean;
  playerName: string;
}

export interface FireServerRequest {
  playerName: string;
  remoteName: string;
  args?: unknown[];
}

export interface FireClientRequest {
  playerName: string;
  remoteName: string;
  args?: unknown[];
}

export interface NetworkClientsResponse {
  clients: string[];
  count: number;
}

export interface RunClientRequest {
  playerName: string;
  script: string;
}

export interface PathFindRequest {
  from: Vector3;
  to: Vector3;
}

export interface PathFindResponse {
  path?: Vector3[];
  found?: boolean;
}

export interface AddObstacleRequest {
  position: Vector3;
  size: Vector3;
  id: string;
}

export interface MoveAgentRequest {
  agentName: string;
  from: Vector3;
  to: Vector3;
  speed?: number;
}

export interface GridInfoResponse {
  cellSize?: number;
  gridWidth?: number;
  gridHeight?: number;
}

export interface DeployRequest {
  projectPath: string;
  universeId?: string;
}

export interface DeployResponse {
  success: boolean;
  deployId?: string;
  rbxlxPath?: string;
  pushedToRoblox?: boolean;
  scriptsDeployed?: number;
  errors?: string[];
}

export interface DeployHistoryResponse {
  deployId: string;
  timestamp: string;
  projectPath: string;
  success: boolean;
}

export interface SaveProjectRequest {
  projectId: string;
  message: string;
}

export interface LoadProjectResponse {
  instances: unknown[];
}

export interface ChangelogEntry {
  timestamp: string;
  message: string;
}

export interface ChangelogResponse {
  changelog: ChangelogEntry[];
}

export interface ProjectsResponse {
  projects: Array<{ id: string; name: string; created: string }>;
}

export interface ObserveStateResponse {
  metadata: {
    timestamp: number;
    tick: number;
    seed?: number;
    deterministic?: boolean;
  };
  instances: InstanceInfo[];
  physics: unknown[];
  dataStore: Record<string, Record<string, unknown>>;
  players: Array<{ name: string; userId?: number; health?: number; position?: Vector3 }>;
}

export interface ScreenshotResponse {
  format: 'png' | 'state-json';
  data: string | unknown;
}

export interface GuiJsonResponse {
  count: number;
  gui: InstanceInfo[];
}

export interface TrajectoryFrame {
  tick: number;
  timestamp: number;
  seed?: number;
  actions?: string[];
  physicsState?: unknown;
  instanceChanges?: unknown;
  consoleOutput?: string;
}

export interface ReplayRequest {
  frames: TrajectoryFrame[];
}

export interface ReplayResponse {
  replayed: number;
  seed?: number;
  finalState?: ObserveStateResponse;
}

export interface SessionCreateRequest {
  label?: string;
  seed?: number;
  deterministic?: boolean;
}

export interface SessionCreateResponse {
  session_id: string;
  seed: number;
  label: string | null;
  createdAt: string;
}

export interface SessionInfo {
  session_id: string;
  label?: string;
  createdAt: string;
  running?: boolean;
  instanceCount?: number;
}

export interface SessionStateResponse extends ObserveStateResponse {
  session_id: string;
  label?: string;
  running: boolean;
  seed: number;
  deterministic: boolean;
}

export interface SessionExecuteResponse {
  session_id: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface SessionResetResponse {
  session_id: string;
  reset: boolean;
  seed: number;
}

export interface SessionMessage {
  from: string;
  event: string;
  data: unknown;
  timestamp: number;
}

export interface BridgeMessageRequest {
  from_session: string;
  to_session: string;
  event: string;
  data?: unknown;
}

export interface BridgeMessageResponse {
  delivered: boolean;
  timestamp: number;
}

export interface ClawBloxClientOptions {
  baseUrl?: string;
  timeout?: number;
}
