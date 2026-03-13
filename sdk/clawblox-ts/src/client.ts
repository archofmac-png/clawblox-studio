import {
  HealthResponse, GameStartOptions, GameStartResponse, GameStopResponse,
  ExecuteRequest, ExecuteResponse, GameState, InstancesResponse, QueryResponse,
  TestRequest, TestResponse, LoadRequest, LoadResponse, SimulateRequest,
  WorkspaceResponse, CreatePartRequest, CreatePartResponse,
  TestRunRequest, TestRunResponse, TestFilesResponse,
  SphereCastRequest, SphereCastResponse, PhysicsStepRequest, PhysicsStepResponse,
  PhysicsBodiesResponse, AddClientRequest, AddClientResponse,
  FireServerRequest, FireClientRequest, NetworkClientsResponse,
  RunClientRequest, PathFindRequest, PathFindResponse,
  AddObstacleRequest, MoveAgentRequest, GridInfoResponse,
  DeployRequest, DeployResponse, DeployHistoryResponse,
  SaveProjectRequest, LoadProjectResponse, ChangelogResponse,
  ProjectsResponse, ObserveStateResponse, ScreenshotResponse, GuiJsonResponse,
  ReplayRequest, ReplayResponse, SessionCreateRequest, SessionCreateResponse,
  SessionInfo, SessionStateResponse, SessionExecuteResponse,
  SessionResetResponse, SessionMessage, BridgeMessageRequest, BridgeMessageResponse,
  ClawBloxClientOptions
} from './types';

/**
 * ClawBloxClient - Low-level REST client for ClawBlox Studio API
 */
export class ClawBloxClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options: ClawBloxClientOptions = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:3001';
    this.timeout = options.timeout || 30000;
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(query).toString();
      url += `?${params}`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, options);
        if (response.status === 429 || response.status === 503) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          lastError = new Error(`Retry after ${response.status}`);
          continue;
        }
        return await response.json() as T;
      } catch (e) {
        lastError = e as Error;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
    throw lastError || new Error('Request failed');
  }

  // Health
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/api/health');
  }

  // Game
  async gameStart(options?: GameStartOptions): Promise<GameStartResponse> {
    return this.request<GameStartResponse>('POST', '/api/game/start', options);
  }

  async gameStop(): Promise<GameStopResponse> {
    return this.request<GameStopResponse>('POST', '/api/game/stop');
  }

  async gameExecute(script: string, options?: GameStartOptions): Promise<ExecuteResponse> {
    return this.request<ExecuteResponse>('POST', '/api/game/execute', { script, ...options });
  }

  async gameState(): Promise<GameState> {
    return this.request<GameState>('GET', '/api/game/state');
  }

  async gameInstances(): Promise<InstancesResponse> {
    return this.request<InstancesResponse>('GET', '/api/game/instances');
  }

  async gameQuery(path: string): Promise<QueryResponse> {
    return this.request<QueryResponse>('GET', '/api/game/query', undefined, { path });
  }

  async gameTest(request: TestRequest): Promise<TestResponse> {
    return this.request<TestResponse>('POST', '/api/game/test', request);
  }

  async gameLoad(request: LoadRequest): Promise<LoadResponse> {
    return this.request<LoadResponse>('POST', '/api/game/load', request);
  }

  async gameSimulate(request: SimulateRequest): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('POST', '/api/game/simulate', request);
  }

  async gameSimulatePlayer(request: SimulateRequest): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('POST', '/api/game/simulate-player', request);
  }

  async gameSnapshot(): Promise<unknown> {
    return this.request<unknown>('GET', '/api/game/state/snapshot');
  }

  async gameDebug(): Promise<unknown> {
    return this.request<unknown>('GET', '/api/game/debug');
  }

  // Workspace
  async workspace(): Promise<WorkspaceResponse> {
    return this.request<WorkspaceResponse>('GET', '/api/workspace');
  }

  async workspaceCreatePart(request: CreatePartRequest): Promise<CreatePartResponse> {
    return this.request<CreatePartResponse>('POST', '/api/workspace/part', request);
  }

  // Tests
  async testRun(request: TestRunRequest): Promise<TestRunResponse> {
    return this.request<TestRunResponse>('POST', '/api/test/run', request);
  }

  async testFiles(): Promise<TestFilesResponse> {
    return this.request<TestFilesResponse>('GET', '/api/test/files');
  }

  // Physics
  async physicsSphereCast(request: SphereCastRequest): Promise<SphereCastResponse> {
    return this.request<SphereCastResponse>('POST', '/api/physics/spherecast', request);
  }

  async physicsStep(request?: PhysicsStepRequest): Promise<PhysicsStepResponse> {
    return this.request<PhysicsStepResponse>('POST', '/api/physics/step', request);
  }

  async physicsBodies(): Promise<PhysicsBodiesResponse> {
    return this.request<PhysicsBodiesResponse>('GET', '/api/physics/bodies');
  }

  // Network
  async networkAddClient(request: AddClientRequest): Promise<AddClientResponse> {
    return this.request<AddClientResponse>('POST', '/api/network/add-client', request);
  }

  async networkFireServer(request: FireServerRequest): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('POST', '/api/network/fire-server', request);
  }

  async networkFireClient(request: FireClientRequest): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('POST', '/api/network/fire-client', request);
  }

  async networkClients(): Promise<NetworkClientsResponse> {
    return this.request<NetworkClientsResponse>('GET', '/api/network/clients');
  }

  async networkRunClient(request: RunClientRequest): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('POST', '/api/network/run-client', request);
  }

  // Pathfinding
  async pathfindingFind(request: PathFindRequest): Promise<PathFindResponse> {
    return this.request<PathFindResponse>('POST', '/api/pathfinding/find', request);
  }

  async pathfindingAddObstacle(request: AddObstacleRequest): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('POST', '/api/pathfinding/add-obstacle', request);
  }

  async pathfindingMoveAgent(request: MoveAgentRequest): Promise<{ started: boolean }> {
    return this.request<{ started: boolean }>('POST', '/api/pathfinding/move-agent', request);
  }

  async pathfindingGrid(): Promise<GridInfoResponse> {
    return this.request<GridInfoResponse>('GET', '/api/pathfinding/grid');
  }

  // Deploy
  async deploy(request: DeployRequest): Promise<DeployResponse> {
    return this.request<DeployResponse>('POST', '/api/deploy', request);
  }

  async deployHistory(): Promise<DeployHistoryResponse[]> {
    return this.request<DeployHistoryResponse[]>('GET', '/api/deploy/history');
  }

  // Project
  async projectSave(request: SaveProjectRequest): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('POST', '/api/project/save', request);
  }

  async projectLoad(projectId: string): Promise<LoadProjectResponse> {
    return this.request<LoadProjectResponse>('GET', `/api/project/load/${projectId}`);
  }

  async projectChangelog(projectId: string): Promise<ChangelogResponse> {
    return this.request<ChangelogResponse>('GET', `/api/project/changelog/${projectId}`);
  }

  async projectList(): Promise<ProjectsResponse> {
    return this.request<ProjectsResponse>('GET', '/api/project/list');
  }

  // Observe
  async observeState(): Promise<ObserveStateResponse> {
    return this.request<ObserveStateResponse>('GET', '/api/observe/state');
  }

  async observeScreenshot(): Promise<ScreenshotResponse> {
    return this.request<ScreenshotResponse>('GET', '/api/observe/screenshot');
  }

  async observeGuiJson(): Promise<GuiJsonResponse> {
    return this.request<GuiJsonResponse>('GET', '/api/observe/gui-json');
  }

  // Simulation
  async simulationExportTrajectory(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/simulation/export_trajectory`);
    return await response.text();
  }

  async simulationReplay(request: ReplayRequest): Promise<ReplayResponse> {
    return this.request<ReplayResponse>('POST', '/api/simulation/replay', request);
  }

  // Sessions
  async sessionCreate(request?: SessionCreateRequest): Promise<SessionCreateResponse> {
    return this.request<SessionCreateResponse>('POST', '/api/session/create', request);
  }

  async sessionList(): Promise<SessionInfo[]> {
    return this.request<SessionInfo[]>('GET', '/api/session/list');
  }

  async sessionDeleteAll(): Promise<{ destroyed: number }> {
    return this.request<{ destroyed: number }>('DELETE', '/api/session/all');
  }

  async sessionDelete(id: string): Promise<{ destroyed: boolean }> {
    return this.request<{ destroyed: boolean }>('DELETE', `/api/session/${id}`);
  }

  async sessionState(id: string): Promise<SessionStateResponse> {
    return this.request<SessionStateResponse>('GET', `/api/session/${id}/state`);
  }

  async sessionExecute(id: string, script: string): Promise<SessionExecuteResponse> {
    return this.request<SessionExecuteResponse>('POST', `/api/session/${id}/execute`, { script });
  }

  async sessionReset(id: string): Promise<SessionResetResponse> {
    return this.request<SessionResetResponse>('POST', `/api/session/${id}/reset`);
  }

  async sessionStart(id: string): Promise<{ session_id: string; running: boolean }> {
    return this.request<{ session_id: string; running: boolean }>('POST', `/api/session/${id}/start`);
  }

  async sessionStop(id: string): Promise<{ session_id: string; running: boolean }> {
    return this.request<{ session_id: string; running: boolean }>('POST', `/api/session/${id}/stop`);
  }

  async sessionMessages(id: string): Promise<SessionMessage[]> {
    return this.request<SessionMessage[]>('GET', `/api/session/${id}/messages`);
  }

  // Messaging Bridge
  async messagingBridge(request: BridgeMessageRequest): Promise<BridgeMessageResponse> {
    return this.request<BridgeMessageResponse>('POST', '/api/messaging/bridge', request);
  }

  // Projects
  async projectsList(): Promise<ProjectsResponse> {
    return this.request<ProjectsResponse>('GET', '/api/projects');
  }

  async projectsCreate(name: string): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>('POST', '/api/projects', { name });
  }

  async projectsGet(id: string): Promise<{ id: string; fileCount: number }> {
    return this.request<{ id: string; fileCount: number }>('GET', `/api/projects/${id}`);
  }

  async projectsDelete(id: string): Promise<{ deleted: string }> {
    return this.request<{ deleted: string }>('DELETE', `/api/projects/${id}`);
  }

  async projectsFiles(id: string): Promise<string[]> {
    return this.request<string[]>('GET', `/api/projects/${id}/files`);
  }

  async projectsExport(id: string): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/api/projects/${id}/export`);
    return await response.blob();
  }

  async projectsSearch(id: string, query: string): Promise<{ query: string; count: number; results: string[] }> {
    return this.request<{ query: string; count: number; results: string[] }>('GET', `/api/projects/${id}/search`, undefined, { q: query });
  }

  // WebSocket connection
  // WebSocket connection - returns an async iterator of events
  // Note: For browser environments, use native WebSocket. For Node.js, install 'ws'.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect(): any {
    const wsUrl = this.baseUrl.replace('http', 'ws') + '/ws';
    const queue: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolver: ((value: IteratorResult<unknown>) => void) | null = null;

    try {
      // Try to use ws package for Node.js
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const WebSocket = require('ws');
      const ws = new WebSocket(wsUrl);

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (resolver) {
            resolver({ done: false, value: msg });
            resolver = null;
          } else {
            queue.push(msg);
          }
        } catch {}
      });

      ws.on('close', () => {
        if (resolver) {
          resolver({ done: true, value: undefined });
          resolver = null;
        }
      });

      ws.on('error', () => {
        if (resolver) {
          resolver({ done: true, value: undefined });
          resolver = null;
        }
      });
    } catch (e) {
      console.warn('WebSocket not available:', e);
    }

    return {
      next: async () => {
        if (queue.length > 0) {
          return { done: false, value: queue.shift() };
        }
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };
  }
}
