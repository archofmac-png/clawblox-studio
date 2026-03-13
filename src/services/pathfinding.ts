/**
 * ClawBlox PathfindingService — Wave 4
 * A* grid pathfinding with obstacle avoidance.
 * Enemies navigate to player positions. PathfindingService shim works.
 */

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface GridCell {
  gx: number; // grid X
  gz: number; // grid Z
}

export interface PathResult {
  path: Vector3[];
  found: boolean;
  length: number;
}

export interface AgentMove {
  agentName: string;
  path: Vector3[];
  etaSeconds: number;
}

export type AgentBroadcastFn = (agentName: string, position: Vector3, done: boolean) => void;

// -------------------------------------------------------------------
// A* min-heap priority queue
// -------------------------------------------------------------------
interface HeapNode {
  cell: GridCell;
  f: number; // f = g + h
  g: number; // cost from start
}

class MinHeap {
  private data: HeapNode[] = [];

  push(node: HeapNode): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapNode | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.data[parent].f <= this.data[i].f) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
      if (smallest === i) break;
      [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
      i = smallest;
    }
  }
}

// -------------------------------------------------------------------
// PathfindingService
// -------------------------------------------------------------------
export class PathfindingService {
  /** Cell size in studs (default: 4 studs = 1 grid cell) */
  private cellSize: number;
  /** World size in studs (grid extends from -worldSize/2 to +worldSize/2) */
  private worldSize: number;
  /** Grid half-size in cells */
  private halfGrid: number;
  /** Blocked cells: key is "gx,gz" */
  private obstacles: Set<string> = new Set();
  /** Obstacle metadata for removal */
  private obstacleIds: Map<string, Set<string>> = new Map(); // id → set of "gx,gz" keys

  /** Broadcast function for agent movement updates */
  private agentBroadcast?: AgentBroadcastFn;

  constructor(cellSize = 4, worldSize = 512) {
    this.cellSize = cellSize;
    this.worldSize = worldSize;
    this.halfGrid = Math.floor(worldSize / 2 / cellSize);
  }

  setAgentBroadcast(fn: AgentBroadcastFn): void {
    this.agentBroadcast = fn;
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Find A* path from world-space `from` to `to`.
   * Returns waypoints in world space.
   */
  findPath(from: Vector3, to: Vector3): PathResult {
    const startCell = this.worldToGrid(from);
    const goalCell = this.worldToGrid(to);

    const rawPath = this.aStar(startCell, goalCell);

    if (rawPath.length === 0) {
      return { path: [], found: false, length: 0 };
    }

    // Convert grid cells back to world-space waypoints
    const path: Vector3[] = rawPath.map(cell => this.gridToWorld(cell, from.y));
    // Replace last waypoint with exact destination
    if (path.length > 0) {
      path[path.length - 1] = { x: to.x, y: to.y, z: to.z };
    }

    // Calculate total path length
    let length = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dz = path[i].z - path[i - 1].z;
      length += Math.sqrt(dx * dx + dz * dz);
    }

    return { path, found: true, length };
  }

  /**
   * Add an obstacle (Part with CanCollide=true) to the grid.
   * Marks all cells overlapping the Part's AABB as blocked.
   */
  addObstacle(id: string, position: Vector3, size: Vector3): void {
    const cells = this.getOverlappingCells(position, size);
    const idCells = new Set<string>();
    for (const key of cells) {
      this.obstacles.add(key);
      idCells.add(key);
    }
    this.obstacleIds.set(id, idCells);
  }

  /**
   * Remove an obstacle by id.
   */
  removeObstacle(id: string): void {
    const cells = this.obstacleIds.get(id);
    if (cells) {
      for (const key of cells) {
        this.obstacles.delete(key);
      }
      this.obstacleIds.delete(id);
    }
  }

  /**
   * Async agent movement: computes path, emits position updates via broadcast.
   * Non-blocking — uses setInterval to simulate movement.
   */
  moveAgent(
    agentName: string,
    from: Vector3,
    to: Vector3,
    speed: number = 16
  ): AgentMove {
    const result = this.findPath(from, to);

    if (!result.found || result.path.length === 0) {
      return { agentName, path: [], etaSeconds: 0 };
    }

    const etaSeconds = result.length / (speed || 16);

    // Simulate agent movement asynchronously (non-blocking)
    if (this.agentBroadcast) {
      let pathIdx = 0;
      const path = result.path;
      const broadcast = this.agentBroadcast;

      // Step through waypoints at `speed` studs/sec intervals
      const stepMs = 200; // emit position every 200ms
      const interval = setInterval(() => {
        if (pathIdx >= path.length) {
          clearInterval(interval);
          broadcast(agentName, path[path.length - 1], true);
          return;
        }
        broadcast(agentName, path[pathIdx], pathIdx === path.length - 1);
        pathIdx++;
      }, stepMs);
    }

    return { agentName, path: result.path, etaSeconds };
  }

  /** Get pathfinding grid info */
  getGridInfo(): { cellSize: number; worldSize: number; obstacleCount: number } {
    return {
      cellSize: this.cellSize,
      worldSize: this.worldSize,
      obstacleCount: this.obstacles.size,
    };
  }

  // -------------------------------------------------------------------
  // A* implementation
  // -------------------------------------------------------------------

  /**
   * Standard A* with Manhattan distance heuristic.
   * Open set as MinHeap for O(log n) performance.
   * Returns grid cell path or [] if no path found.
   */
  private aStar(start: GridCell, goal: GridCell): GridCell[] {
    const key = (c: GridCell) => `${c.gx},${c.gz}`;

    // Fast path: same cell
    if (key(start) === key(goal)) {
      return [start];
    }

    const openSet = new MinHeap();
    const cameFrom = new Map<string, GridCell>();
    const gScore = new Map<string, number>();
    const inOpen = new Set<string>();

    const startKey = key(start);
    gScore.set(startKey, 0);
    openSet.push({ cell: start, f: this.heuristic(start, goal), g: 0 });
    inOpen.add(startKey);

    let iterations = 0;
    const MAX_ITERATIONS = this.halfGrid * this.halfGrid * 4; // safety cap

    while (openSet.size > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      const current = openSet.pop()!;
      const currentKey = key(current.cell);
      inOpen.delete(currentKey);

      // Reached goal?
      if (currentKey === key(goal)) {
        return this.reconstructPath(cameFrom, current.cell, key);
      }

      // Explore 8-connected neighbors
      for (const neighbor of this.getNeighbors(current.cell)) {
        const neighborKey = key(neighbor);

        // Skip blocked cells
        if (this.obstacles.has(neighborKey)) continue;

        // Skip out-of-bounds
        if (!this.inBounds(neighbor)) continue;

        // Diagonal movement costs more
        const isDiag =
          neighbor.gx !== current.cell.gx &&
          neighbor.gz !== current.cell.gz;
        const moveCost = isDiag ? 1.414 : 1.0;

        const tentativeG = (gScore.get(currentKey) ?? Infinity) + moveCost;
        const prevG = gScore.get(neighborKey) ?? Infinity;

        if (tentativeG < prevG) {
          cameFrom.set(neighborKey, current.cell);
          gScore.set(neighborKey, tentativeG);
          const f = tentativeG + this.heuristic(neighbor, goal);

          if (!inOpen.has(neighborKey)) {
            openSet.push({ cell: neighbor, f, g: tentativeG });
            inOpen.add(neighborKey);
          }
        }
      }
    }

    // No path found
    return [];
  }

  private heuristic(a: GridCell, b: GridCell): number {
    // Octile distance (handles diagonals correctly)
    const dx = Math.abs(a.gx - b.gx);
    const dz = Math.abs(a.gz - b.gz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  }

  private getNeighbors(cell: GridCell): GridCell[] {
    const { gx, gz } = cell;
    return [
      { gx: gx - 1, gz },     // W
      { gx: gx + 1, gz },     // E
      { gx, gz: gz - 1 },     // N
      { gx, gz: gz + 1 },     // S
      { gx: gx - 1, gz: gz - 1 }, // NW
      { gx: gx + 1, gz: gz - 1 }, // NE
      { gx: gx - 1, gz: gz + 1 }, // SW
      { gx: gx + 1, gz: gz + 1 }, // SE
    ];
  }

  private reconstructPath(
    cameFrom: Map<string, GridCell>,
    current: GridCell,
    key: (c: GridCell) => string
  ): GridCell[] {
    const path: GridCell[] = [current];
    let cur = current;
    while (cameFrom.has(key(cur))) {
      cur = cameFrom.get(key(cur))!;
      path.unshift(cur);
    }
    return path;
  }

  // -------------------------------------------------------------------
  // Grid helpers
  // -------------------------------------------------------------------

  private worldToGrid(pos: Vector3): GridCell {
    return {
      gx: Math.round(pos.x / this.cellSize),
      gz: Math.round(pos.z / this.cellSize),
    };
  }

  private gridToWorld(cell: GridCell, y: number): Vector3 {
    return {
      x: cell.gx * this.cellSize,
      y,
      z: cell.gz * this.cellSize,
    };
  }

  private inBounds(cell: GridCell): boolean {
    return (
      cell.gx >= -this.halfGrid &&
      cell.gx <= this.halfGrid &&
      cell.gz >= -this.halfGrid &&
      cell.gz <= this.halfGrid
    );
  }

  /**
   * Get all grid cells overlapping a world-space AABB.
   */
  private getOverlappingCells(position: Vector3, size: Vector3): string[] {
    const minX = position.x - size.x / 2;
    const maxX = position.x + size.x / 2;
    const minZ = position.z - size.z / 2;
    const maxZ = position.z + size.z / 2;

    const startGX = Math.floor(minX / this.cellSize);
    const endGX = Math.ceil(maxX / this.cellSize);
    const startGZ = Math.floor(minZ / this.cellSize);
    const endGZ = Math.ceil(maxZ / this.cellSize);

    const cells: string[] = [];
    for (let gx = startGX; gx <= endGX; gx++) {
      for (let gz = startGZ; gz <= endGZ; gz++) {
        cells.push(`${gx},${gz}`);
      }
    }
    return cells;
  }
}

// Singleton export
export const pathfindingService = new PathfindingService();
