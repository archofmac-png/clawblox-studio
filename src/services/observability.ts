/**
 * ClawBlox Studio — Structured Observability Layer (Wave A)
 *
 * Serialization helpers and type definitions for the /api/observe/* endpoints.
 * All helpers are pure functions with no side effects.
 */

import { InstanceRecord } from './game-engine.js';

// ---------------------------------------------------------------------------
// Serialized math types
// ---------------------------------------------------------------------------

/** Serialized CFrame: position + 3×3 rotation matrix in row-major order */
export interface SerializedCFrame {
  position: [number, number, number];
  rotation: [number, number, number, number, number, number, number, number, number];
}

/** Serialized Vector3 as [x, y, z] */
export type SerializedVector3 = [number, number, number];

/** Serialized Color3 as [r, g, b] (0–255 integers) */
export type SerializedColor3 = [number, number, number];

// ---------------------------------------------------------------------------
// Serialized instance tree
// ---------------------------------------------------------------------------

/** A fully-serialized instance record for the observe/state response */
export interface SerializedInstance {
  id: string;
  className: string;
  name: string;
  parentId: string | null;
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Physics body snapshot
// ---------------------------------------------------------------------------

export interface SerializedPhysicsBody {
  id: string;
  name: string;
  position: SerializedVector3;
  velocity: SerializedVector3;
  angularVelocity: SerializedVector3;
  mass: number;
}

// ---------------------------------------------------------------------------
// Full observe state
// ---------------------------------------------------------------------------

export interface ObserveMetadata {
  timestamp: number;
  tick: number;
  seed: number;
  deterministic: boolean;
}

export interface ObservePlayerState {
  name: string;
  userId: number;
  health: number;
  position: SerializedVector3;
}

export interface ObserveState {
  metadata: ObserveMetadata;
  instances: SerializedInstance[];
  physics: SerializedPhysicsBody[];
  dataStore: Record<string, Record<string, unknown>>;
  players: ObservePlayerState[];
}

// ---------------------------------------------------------------------------
// WebSocket typed events
// ---------------------------------------------------------------------------

export interface WsEventInstanceCreated {
  event: 'instance:created';
  id: string;
  className: string;
  name: string;
  parentId: string | null;
  properties: Record<string, unknown>;
}

export interface WsEventInstanceChanged {
  event: 'instance:changed';
  id: string;
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface WsEventPhysicsTick {
  event: 'physics:tick';
  tick: number;
  timestamp: number;
  bodies: SerializedPhysicsBody[];
}

export interface WsEventConsoleStructured {
  event: 'console:structured';
  level: 'print' | 'warn' | 'error';
  message: string;
  traceback: string | null;
  tick: number;
}

export interface WsEventObserveState {
  event: 'observe:state';
  data: ObserveState;
}

export type WsTypedEvent =
  | WsEventInstanceCreated
  | WsEventInstanceChanged
  | WsEventPhysicsTick
  | WsEventConsoleStructured
  | WsEventObserveState;

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a raw Vector3-like value (with X/Y/Z or x/y/z fields, or an array)
 * into a canonical [x, y, z] tuple.
 *
 * @param v - Raw vector value from the instance registry
 * @param fallback - Fallback tuple when v is invalid
 */
export function serializeVector3(
  v: unknown,
  fallback: SerializedVector3 = [0, 0, 0],
): SerializedVector3 {
  if (v === null || v === undefined) return fallback;
  if (Array.isArray(v) && v.length >= 3) {
    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const x = Number(obj['X'] ?? obj['x'] ?? 0);
    const y = Number(obj['Y'] ?? obj['y'] ?? 0);
    const z = Number(obj['Z'] ?? obj['z'] ?? 0);
    return [x, y, z];
  }
  return fallback;
}

/**
 * Serialize a CFrame-like value into { position, rotation }.
 * Supports both our internal CFrame format (with R array) and raw position objects.
 *
 * @param v - Raw CFrame value from the instance registry
 */
export function serializeCFrame(v: unknown): SerializedCFrame {
  const identity: SerializedCFrame = {
    position: [0, 0, 0],
    rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };

  if (v === null || v === undefined) return identity;
  if (typeof v !== 'object') return identity;

  const obj = v as Record<string, unknown>;

  const x = Number(obj['X'] ?? obj['x'] ?? obj['position']?.['x'] ?? 0);
  const y = Number(obj['Y'] ?? obj['y'] ?? obj['position']?.['y'] ?? 0);
  const z = Number(obj['Z'] ?? obj['z'] ?? obj['position']?.['z'] ?? 0);

  // Try to extract a rotation matrix (stored as R array by our Lua shim)
  const R = obj['R'];
  if (Array.isArray(R) && R.length === 9) {
    return {
      position: [x, y, z],
      rotation: [
        Number(R[0]), Number(R[1]), Number(R[2]),
        Number(R[3]), Number(R[4]), Number(R[5]),
        Number(R[6]), Number(R[7]), Number(R[8]),
      ],
    };
  }

  // Try individual r00..r22 fields
  if (obj['r00'] !== undefined) {
    return {
      position: [x, y, z],
      rotation: [
        Number(obj['r00']), Number(obj['r01']), Number(obj['r02']),
        Number(obj['r10']), Number(obj['r11']), Number(obj['r12']),
        Number(obj['r20']), Number(obj['r21']), Number(obj['r22']),
      ],
    };
  }

  return { position: [x, y, z], rotation: identity.rotation };
}

/**
 * Serialize a Color3-like value into [r, g, b] (0–255 integers).
 *
 * @param v - Raw color value (may be 0–1 floats or 0–255 integers)
 * @param fallback - Fallback when v is invalid
 */
export function serializeColor3(
  v: unknown,
  fallback: SerializedColor3 = [163, 162, 165],
): SerializedColor3 {
  if (v === null || v === undefined) return fallback;
  if (Array.isArray(v) && v.length >= 3) {
    const [r, g, b] = [Number(v[0]), Number(v[1]), Number(v[2])];
    // If all ≤ 1 and not all 0, treat as float
    if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    let r = Number(obj['R'] ?? obj['r'] ?? fallback[0]);
    let g = Number(obj['G'] ?? obj['g'] ?? fallback[1]);
    let b = Number(obj['B'] ?? obj['b'] ?? fallback[2]);
    if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
      r = Math.round(r * 255);
      g = Math.round(g * 255);
      b = Math.round(b * 255);
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  }
  return fallback;
}

/**
 * Determine if a property key represents a Vector3 field.
 */
function isVector3Key(key: string): boolean {
  const v3Keys = new Set(['Position', 'Size', 'Velocity', 'RotVelocity', 'LookVector', 'RightVector', 'UpVector']);
  return v3Keys.has(key);
}

/**
 * Determine if a property key represents a Color3 field.
 */
function isColor3Key(key: string): boolean {
  const colorKeys = new Set(['Color', 'Color3', 'BackgroundColor3', 'TextColor3', 'BorderColor3', 'BrickColor']);
  return colorKeys.has(key);
}

/**
 * Determine if a property key represents a CFrame field.
 */
function isCFrameKey(key: string): boolean {
  return key === 'CFrame';
}

/**
 * Serialize a single property value, applying the correct serializer based on key name.
 */
export function serializeProperty(key: string, value: unknown): unknown {
  if (isCFrameKey(key)) return serializeCFrame(value);
  if (isVector3Key(key)) return serializeVector3(value);
  if (isColor3Key(key)) return serializeColor3(value);

  // Skip non-serializable types
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'object' && value !== null) {
    try {
      // Shallow-serialize plain objects/arrays
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  return value;
}

/** Properties that are Lua methods leaked into the registry — skip them. */
const SKIP_PROPERTY_KEYS = new Set([
  'FindFirstChild', 'WaitForChild', 'GetChildren', 'GetDescendants',
  'GetFullName', 'IsA', 'Destroy', 'Clone', '_addChild',
  'Connect', 'Fire', 'Wait', 'Disconnect',
  'Play', 'Cancel', 'Pause', 'GetAsync', 'SetAsync',
]);

/**
 * Serialize an InstanceRecord into the wire format for /api/observe/state.
 *
 * @param record - Raw instance record from the game engine registry
 */
export function serializeInstance(record: InstanceRecord): SerializedInstance {
  const serializedProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record.properties)) {
    // Skip internal marker keys and Lua method stubs
    if (key.startsWith('_')) continue;
    if (SKIP_PROPERTY_KEYS.has(key)) continue;
    // Skip actual function values
    if (typeof value === 'function') continue;
    serializedProps[key] = serializeProperty(key, value);
  }

  return {
    id: record.id,
    className: record.ClassName,
    name: record.Name,
    parentId: record.parentId,
    properties: serializedProps,
  };
}

/**
 * Build the full /api/observe/state payload.
 *
 * @param instances - All instance records from the registry
 * @param physicsBodies - Physics body info from PhysicsWorld
 * @param dataStore - Key-value map of all DataStore data
 * @param players - Live player states
 * @param metadata - Tick, seed, timestamp, determinism flag
 */
export function buildObserveState(
  instances: InstanceRecord[],
  physicsBodies: SerializedPhysicsBody[],
  dataStore: Record<string, Record<string, unknown>>,
  players: ObservePlayerState[],
  metadata: ObserveMetadata,
): ObserveState {
  return {
    metadata,
    instances: instances.map(serializeInstance),
    physics: physicsBodies,
    dataStore,
    players,
  };
}

/**
 * Walk the instance tree and collect GUI-relevant instances
 * (ScreenGui, Frame, TextLabel, ImageLabel, TextButton, ImageButton, etc.)
 *
 * @param instances - All instance records
 */
export function extractGuiTree(instances: InstanceRecord[]): SerializedInstance[] {
  const GUI_CLASSES = new Set([
    'ScreenGui', 'BillboardGui', 'SurfaceGui',
    'Frame', 'ScrollingFrame',
    'TextLabel', 'TextButton', 'TextBox',
    'ImageLabel', 'ImageButton',
    'ViewportFrame',
    'UIListLayout', 'UIGridLayout', 'UIPageLayout',
    'UIPadding', 'UICorner', 'UIStroke',
  ]);

  return instances
    .filter(inst => GUI_CLASSES.has(inst.ClassName))
    .map(serializeInstance);
}
