/**
 * ClawBlox PhysicsWorld — Wave 4
 * Wraps cannon-es to give Parts real positions and enable SphereCast.
 * ~80% Roblox fidelity: basic body sync + sphere/AABB overlap queries.
 */

import * as CANNON from 'cannon-es';
import { InstanceRecord } from './game-engine.js';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsBodyInfo {
  id: string;
  name: string;
  position: Vector3;
  size: Vector3;
}

export interface SphereHit {
  name: string;
  className: string;
  position: Vector3;
}

// -------------------------------------------------------------------
// PhysicsWorld
// -------------------------------------------------------------------
export class PhysicsWorld {
  private world: CANNON.World;
  /** Map from instance id → cannon-es body */
  private bodies: Map<string, CANNON.Body> = new Map();
  /** Map from instance id → size (for AABB queries) */
  private sizes: Map<string, Vector3> = new Map();
  /** Map from instance id → InstanceRecord reference */
  private instances: Map<string, InstanceRecord> = new Map();

  // Wave B: Deterministic fixed timestep mode
  private _deterministic = false;
  private readonly FIXED_DT = 1 / 60;

  /** Enable or disable deterministic fixed-timestep mode. */
  setDeterministicMode(enabled: boolean): void {
    this._deterministic = enabled;
  }

  isDeterministic(): boolean { return this._deterministic; }

  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -196.2, 0), // Roblox uses ~196.2 studs/s²
    });
    // Broadphase for efficient collision detection
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.allowSleep = true;
  }

  /**
   * Register a Part instance in the physics world.
   * Creates a cannon-es Body with Box shape at Part's Position/Size.
   * Anchored Parts become STATIC bodies (mass=0).
   * Non-Anchored Parts become DYNAMIC bodies (mass>0).
   */
  registerPart(instance: InstanceRecord): void {
    if (this.bodies.has(instance.id)) {
      // Already registered — sync position instead
      this.syncPartPosition(instance);
      return;
    }

    const pos = this.extractVector3(instance.properties['Position']) ?? { x: 0, y: 0, z: 0 };
    const size = this.extractVector3(instance.properties['Size']) ?? { x: 4, y: 1, z: 4 };
    // Check Anchored property: true/undefined = STATIC, false = DYNAMIC
    // In Roblox, Parts are anchored by default (Anchored = true)
    const anchored = instance.properties['Anchored'];
    const isAnchored = anchored !== false; // STATIC unless explicitly set to false
    const mass = isAnchored ? 0 : 1; // STATIC if Anchored, DYNAMIC otherwise

    // Store size for later AABB queries
    this.sizes.set(instance.id, size);
    this.instances.set(instance.id, instance);

    // cannon-es Box half-extents
    const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
    const shape = new CANNON.Box(halfExtents);

    const body = new CANNON.Body({
      mass,
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      shape,
    });

    // Set body type for cannon-es
    body.type = isAnchored ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;

    this.world.addBody(body);
    this.bodies.set(instance.id, body);
  }

  /**
   * Remove a Part from the physics world.
   */
  removePart(id: string): void {
    const body = this.bodies.get(id);
    if (body) {
      this.world.removeBody(body);
      this.bodies.delete(id);
      this.sizes.delete(id);
      this.instances.delete(id);
    }
  }

  /**
   * Sync a Part's Position to its cannon-es body.
   * Called when Part.Position is set in Lua.
   * For non-anchored (dynamic) parts, we also zero velocity to implement teleport behavior.
   */
  syncPartPosition(instance: InstanceRecord): void {
    const body = this.bodies.get(instance.id);
    if (!body) return;

    const pos = this.extractVector3(instance.properties['Position']);
    if (pos) {
      body.position.set(pos.x, pos.y, pos.z);
      // For non-anchored (dynamic) parts, zero velocity to implement teleport behavior.
      // This matches Roblox Studio where setting Position on a non-anchored part teleports it.
      if (body.type === CANNON.Body.DYNAMIC) {
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
      }
      body.wakeUp();
    }

    // Also sync size if it changed
    const size = this.extractVector3(instance.properties['Size']);
    if (size) {
      const stored = this.sizes.get(instance.id);
      const sizeChanged = !stored || stored.x !== size.x || stored.y !== size.y || stored.z !== size.z;
      if (sizeChanged) {
        // Rebuild shape with new size
        if (body.shapes.length > 0) {
          body.removeShape(body.shapes[0]);
        }
        const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
        body.addShape(new CANNON.Box(halfExtents));
        this.sizes.set(instance.id, size);
      }
    }
  }

  /**
   * Set velocity directly on a cannon-es body.
   * Used by RL agents to move characters via Velocity (not Position).
   * This is the primary movement API for RL agents.
   */
  setVelocity(id: string, velocity: Vector3): void {
    const body = this.bodies.get(id);
    if (!body) return;
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.wakeUp();
  }

  /**
   * Get velocity of a body for reading back to Lua.
   */
  getVelocity(id: string): Vector3 | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    return { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z };
  }

  /**
   * SphereCast: returns all Part instances whose AABB overlaps a sphere
   * swept along direction * distance from origin with the given radius.
   *
   * Implementation: AABB vs sphere overlap check for each body.
   * This answers "which Parts are within radius R of origin O?" with
   * ~80% Roblox fidelity (no sub-Part precision, no mesh shapes).
   */
  sphereCast(
    origin: Vector3,
    direction: Vector3,
    radius: number,
    distance: number
  ): InstanceRecord[] {
    const hits: InstanceRecord[] = [];

    for (const [id, body] of this.bodies) {
      const instance = this.instances.get(id);
      if (!instance) continue;

      const size = this.sizes.get(id) ?? { x: 4, y: 1, z: 4 };
      const bpos = body.position;

      // Check if the swept sphere (approximated as a sphere at origin with radius+distance/2)
      // or the sphere at the end of the cast overlaps the Part's AABB.
      // Strategy: check sphere at origin, sphere at end, and midpoints.
      const endX = origin.x + direction.x * distance;
      const endY = origin.y + direction.y * distance;
      const endZ = origin.z + direction.z * distance;

      // AABB bounds of the Part
      const minX = bpos.x - size.x / 2;
      const maxX = bpos.x + size.x / 2;
      const minY = bpos.y - size.y / 2;
      const maxY = bpos.y + size.y / 2;
      const minZ = bpos.z - size.z / 2;
      const maxZ = bpos.z + size.z / 2;

      // Find closest point on AABB to the line segment (origin → end)
      const closestDist = this.minDistanceSegmentAABB(
        origin.x, origin.y, origin.z,
        endX, endY, endZ,
        minX, maxX, minY, maxY, minZ, maxZ
      );

      if (closestDist <= radius) {
        hits.push(instance);
      }
    }

    return hits;
  }

  /**
   * Simple sphere overlap: returns all Parts within radius of center.
   * Used by workspace:FindPartsInRadius().
   */
  findPartsInRadius(center: Vector3, radius: number): InstanceRecord[] {
    const hits: InstanceRecord[] = [];

    for (const [id, body] of this.bodies) {
      const instance = this.instances.get(id);
      if (!instance) continue;

      const size = this.sizes.get(id) ?? { x: 4, y: 1, z: 4 };
      const bpos = body.position;

      // Distance from center to closest point on Part's AABB
      const dx = Math.max(
        Math.abs(center.x - bpos.x) - size.x / 2,
        0
      );
      const dy = Math.max(
        Math.abs(center.y - bpos.y) - size.y / 2,
        0
      );
      const dz = Math.max(
        Math.abs(center.z - bpos.z) - size.z / 2,
        0
      );
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist <= radius) {
        hits.push(instance);
      }
    }

    return hits;
  }

  /**
   * Advance the physics simulation by dt seconds.
   * In deterministic mode, always uses the fixed 1/60s timestep.
   */
  step(dt: number = 1 / 60): void {
    const effectiveDt = this._deterministic ? this.FIXED_DT : dt;
    this.world.step(effectiveDt);
  }

  /**
   * Sync all dynamic body positions back to their instance records.
   * Call this after each physics step to update Part positions in the registry.
   */
  syncAllPositions(): void {
    for (const [id, body] of this.bodies) {
      // Only sync dynamic bodies (Anchored = false)
      if (body.type === CANNON.Body.DYNAMIC) {
        const instance = this.instances.get(id);
        if (instance) {
          instance.properties['Position'] = {
            X: body.position.x,
            Y: body.position.y,
            Z: body.position.z,
          };
        }
      }
    }
  }

  /**
   * Get the current position of a Part from its cannon-es body.
   */
  getPartPosition(id: string): Vector3 | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    return { x: body.position.x, y: body.position.y, z: body.position.z };
  }

  /**
   * Get all registered bodies for the /api/physics/bodies endpoint.
   */
  getAllBodies(): PhysicsBodyInfo[] {
    const result: PhysicsBodyInfo[] = [];
    for (const [id, body] of this.bodies) {
      const instance = this.instances.get(id);
      const size = this.sizes.get(id) ?? { x: 4, y: 1, z: 4 };
      result.push({
        id,
        name: instance?.Name ?? id,
        position: { x: body.position.x, y: body.position.y, z: body.position.z },
        size,
      });
    }
    return result;
  }

  getBodyCount(): number {
    return this.bodies.size;
  }

  /**
   * Wave A: Return all physics bodies serialized for the observability layer.
   * Includes position, velocity, angularVelocity, and mass.
   */
  getSerializedBodies(): Array<{
    id: string;
    name: string;
    position: [number, number, number];
    velocity: [number, number, number];
    angularVelocity: [number, number, number];
    mass: number;
  }> {
    const result: Array<{
      id: string;
      name: string;
      position: [number, number, number];
      velocity: [number, number, number];
      angularVelocity: [number, number, number];
      mass: number;
    }> = [];
    for (const [id, body] of this.bodies) {
      const instance = this.instances.get(id);
      result.push({
        id,
        name: instance?.Name ?? id,
        position: [body.position.x, body.position.y, body.position.z],
        velocity: [body.velocity.x, body.velocity.y, body.velocity.z],
        angularVelocity: [body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z],
        mass: body.mass,
      });
    }
    return result;
  }

  /**
   * Reset the physics world: remove all bodies.
   * Called when the game engine is restarted.
   */
  reset(): void {
    // Remove all bodies from the cannon-es world
    for (const [, body] of this.bodies) {
      this.world.removeBody(body);
    }
    this.bodies.clear();
    this.sizes.clear();
    this.instances.clear();
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  /**
   * Extract a Vector3 from the stored property value.
   * Handles both object form and serialized strings.
   */
  private extractVector3(val: unknown): Vector3 | null {
    if (!val) return null;
    if (typeof val === 'object' && val !== null) {
      const v = val as Record<string, unknown>;
      // Handle both lowercase (internal) and uppercase (Lua Vector3) keys
      const x = Number(v['X'] ?? v['x'] ?? 0);
      const y = Number(v['Y'] ?? v['y'] ?? 0);
      const z = Number(v['Z'] ?? v['z'] ?? 0);
      // Validate we got real numbers (not NaN from non-numeric values)
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        return { x, y, z };
      }
    }
    return null;
  }

  /**
   * Minimum distance from a line segment (P0→P1) to an AABB.
   * Used for swept-sphere vs AABB queries.
   */
  private minDistanceSegmentAABB(
    p0x: number, p0y: number, p0z: number,
    p1x: number, p1y: number, p1z: number,
    minX: number, maxX: number,
    minY: number, maxY: number,
    minZ: number, maxZ: number
  ): number {
    // Sample multiple points along the segment and take min dist-to-AABB
    const steps = 8;
    let minDist = Infinity;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = p0x + (p1x - p0x) * t;
      const py = p0y + (p1y - p0y) * t;
      const pz = p0z + (p1z - p0z) * t;

      // Closest point on AABB to this sample
      const cx = Math.max(minX, Math.min(maxX, px));
      const cy = Math.max(minY, Math.min(maxY, py));
      const cz = Math.max(minZ, Math.min(maxZ, pz));

      const dx = px - cx;
      const dy = py - cy;
      const dz = pz - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < minDist) minDist = dist;
    }

    return minDist;
  }
}

// Singleton export
export const physicsWorld = new PhysicsWorld();
