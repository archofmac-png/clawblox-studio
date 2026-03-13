// Wave 5 — Live Rendering Sync
// Connects to backend WebSocket (port 3002), receives structured game events,
// and updates Babylon.js meshes in real-time.
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Engine, Scene, ArcRotateCamera, Vector3,
  HemisphericLight, DirectionalLight, MeshBuilder,
  StandardMaterial, Color3, Color4, HighlightLayer,
  DynamicTexture, Animation, EasingFunction, SineEase,
} from "@babylonjs/core";
import * as CANNON from "cannon-es";

const GAME_API_URL = "http://localhost:3001";

// Visual instance classes — only render these in the viewport
const RENDERABLE_CLASSES = new Set([
  "Part", "BasePart", "MeshPart", "SpecialMesh", "WedgePart", "CornerWedgePart",
  "SpawnLocation", "Model", "Seat", "VehicleSeat", "UnionOperation", "Truss",
]);
const PLAYER_CLASSES = new Set(["Model"]);
// Service names we should never render
const SERVICE_NAMES = new Set([
  "Players", "Workspace", "ReplicatedStorage", "ServerScriptService",
  "RunService", "DataStoreService", "CollectionService", "TweenService",
  "UserInputService", "HttpService", "Debris", "MessagingService",
  "PathfindingService", "PhysicsService", "ServerStorage", "SoundService",
  "StarterGui", "StarterPack", "StarterPlayer", "Teams", "Chat",
  "InsertService", "MarketplaceService", "AnalyticsService",
]);

/** Seeded hash → Color3 for a given name string */
function seededColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  const r = ((hash >> 16) & 0xff) / 255;
  const g = ((hash >> 8) & 0xff) / 255;
  const b = (hash & 0xff) / 255;
  // Clamp to mid-brightness range so colors look nice on the dark background
  const clamp = (v) => 0.3 + v * 0.6;
  return new Color3(clamp(r), clamp(g), clamp(b));
}

/** Parse position from instance Properties if available */
function parsePosition(inst) {
  try {
    const props = inst.Properties || inst.properties || {};
    const pos = props.Position || props.position || props.CFrame;
    if (pos && typeof pos === "object") {
      const x = pos.x ?? pos.X ?? pos[0] ?? 0;
      const y = pos.y ?? pos.Y ?? pos[1] ?? 0;
      const z = pos.z ?? pos.Z ?? pos[2] ?? 0;
      return new Vector3(parseFloat(x) || 0, parseFloat(y) || 0, parseFloat(z) || 0);
    }
  } catch {}
  return null;
}

/** Determine if an instance should be rendered as a player character */
function isPlayerLike(inst) {
  return PLAYER_CLASSES.has(inst.ClassName) &&
    !SERVICE_NAMES.has(inst.Name) &&
    (inst.Path?.includes("Players") || inst.Path?.includes("Character"));
}

/** Determine if an instance is visually renderable */
function isRenderable(inst) {
  if (SERVICE_NAMES.has(inst.Name) && !inst.Path?.includes("/")) return false;
  return RENDERABLE_CLASSES.has(inst.ClassName);
}

const GAME_API_URL_WS = "ws://localhost:3002";

// ─── Wave 5 scene helper functions ──────────────────────────────────────────

/**
 * Create a floating text label above a parent mesh using DynamicTexture.
 * Returns a flat plane mesh parented to `parentMesh`.
 */
function _createFloatingLabel(scene, text, parentMesh, yOffset, color) {
  try {
    const texSize = 256;
    const texture = new DynamicTexture(`lbl_tex_${text}_${Date.now()}`, { width: texSize, height: 64 }, scene);
    texture.hasAlpha = true;
    const ctx = texture.getContext();
    ctx.clearRect(0, 0, texSize, 64);
    ctx.font = "bold 28px Arial";
    ctx.fillStyle = color ? `rgb(${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)})` : "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(text, texSize / 2, 44);
    texture.update();

    const plane = MeshBuilder.CreatePlane(`lbl_${text}_${Date.now()}`, { width: 3.5, height: 0.8 }, scene);
    plane.billboardMode = 7; // always face camera (BILLBOARDMODE_ALL)
    plane.position.y = yOffset ?? 3;
    plane.isPickable = false;
    plane.parent = parentMesh;

    const mat = new StandardMaterial(`lbl_mat_${text}_${Date.now()}`, scene);
    mat.diffuseTexture = texture;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    plane.material = mat;

    return plane;
  } catch {
    return null;
  }
}

/**
 * Create a health bar (two flat boxes: background + foreground) parented to parentMesh.
 * Returns an object { bg, fg } with both meshes.
 */
function _createHealthBar(scene, key, parentMesh, health, maxHealth) {
  try {
    const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 1;
    const barWidth = 2.4;
    const barHeight = 0.22;
    const yOff = 2.0;

    // Background (dark red)
    const bg = MeshBuilder.CreateBox(`hbar_bg_${key}`, { width: barWidth, height: barHeight, depth: 0.05 }, scene);
    bg.position.y = yOff;
    bg.billboardMode = 7;
    bg.isPickable = false;
    bg.parent = parentMesh;
    const bgMat = new StandardMaterial(`hbar_bg_mat_${key}`, scene);
    bgMat.diffuseColor = new Color3(0.25, 0.05, 0.05);
    bgMat.disableLighting = true;
    bg.material = bgMat;

    // Foreground (green → red)
    const fgWidth = barWidth * ratio;
    const fg = MeshBuilder.CreateBox(`hbar_fg_${key}`, { width: fgWidth, height: barHeight, depth: 0.06 }, scene);
    fg.position.y = yOff;
    fg.position.x = -(barWidth - fgWidth) / 2; // left-align
    fg.billboardMode = 7;
    fg.isPickable = false;
    fg.parent = parentMesh;
    const fgMat = new StandardMaterial(`hbar_fg_mat_${key}`, scene);
    // Color from green (full) to red (empty)
    fgMat.diffuseColor = new Color3(1 - ratio, ratio * 0.8, 0.05);
    fgMat.disableLighting = true;
    fg.material = fgMat;

    return { bg, fg, barWidth };
  } catch {
    return null;
  }
}

/**
 * Update an existing health bar's foreground mesh scale/color.
 */
function _updateHealthBarMesh(healthBar, health, maxHealth) {
  if (!healthBar || !healthBar.fg) return;
  try {
    const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 1;
    const barWidth = healthBar.barWidth ?? 2.4;
    const fgWidth = barWidth * ratio;
    healthBar.fg.scaling.x = ratio;
    healthBar.fg.position.x = -(barWidth - fgWidth) / 2;
    const fgMat = healthBar.fg.material;
    if (fgMat) fgMat.diffuseColor = new Color3(1 - ratio, ratio * 0.8, 0.05);
  } catch {}
}

export default function Viewport3D({ colors, addOutput, gridEnabled = true, physicsEnabled = true, cameraMode = "orbit" }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const sceneRef = useRef(null);
  const worldRef = useRef(null);
  const bodiesRef = useRef({});
  const meshMapRef = useRef({}); // instance polling meshes (legacy)
  const highlightRef = useRef(null);
  const selectedMeshRef = useRef(null);
  const pollRef = useRef(null);
  const gridMeshesRef = useRef([]);
  const cameraRef = useRef(null);

  // Wave 5 — Live Rendering Sync refs
  const wsRef = useRef(null);
  const wsReconnectRef = useRef(null);
  const partMeshesRef = useRef({}); // id → mesh (from game events)
  const playerMeshesRef = useRef({}); // name → { mesh, labelMesh }
  const enemyMeshesRef = useRef({}); // id → { mesh, healthBar, labelMesh }
  const pendingEventsRef = useRef([]); // event queue for rAF batching
  const rafPendingRef = useRef(false);

  const [selectedLabel, setSelectedLabel] = useState(null);
  const [instanceCount, setInstanceCount] = useState(0);
  const [livePartCount, setLivePartCount] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);

  // --- Init Babylon scene ---
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(canvasRef.current, true, { preserveDrawingBuffer: true, stencil: true });
    engineRef.current = engine;
    const scene = new Scene(engine);
    sceneRef.current = scene;
    scene.clearColor = new Color4(0.10, 0.10, 0.13, 1.0);

    // Arc-rotate camera with orbit controls
    const camera = new ArcRotateCamera("cam", -Math.PI / 4, Math.PI / 3.5, 30, new Vector3(0, 2, 0), scene);
    camera.attachControl(canvasRef.current, true);
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 300;
    camera.wheelPrecision = 5;
    camera.panningSensibility = 100;
    camera.minZ = 0.1;
    cameraRef.current = camera;

    // Lights
    const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.55;
    ambient.groundColor = new Color3(0.08, 0.08, 0.12);
    const dirLight = new DirectionalLight("dir", new Vector3(-1, -2, -1), scene);
    dirLight.intensity = 0.9;
    dirLight.position = new Vector3(20, 40, 20);

    // Highlight layer for selection
    const hl = new HighlightLayer("hl", scene);
    highlightRef.current = hl;

    // Baseplate (100×1×100, flat grey)
    const baseplate = MeshBuilder.CreateBox("Baseplate", { width: 100, height: 1, depth: 100 }, scene);
    baseplate.position.y = -0.5;
    const bpMat = new StandardMaterial("bpMat", scene);
    bpMat.diffuseColor = new Color3(0.20, 0.20, 0.23);
    bpMat.specularColor = new Color3(0.05, 0.05, 0.05);
    baseplate.material = bpMat;
    baseplate.isPickable = false;
    meshMapRef.current["__baseplate__"] = baseplate;

    // Grid builder (stored on sceneRef for external toggling)
    function buildGrid(visible) {
      gridMeshesRef.current.forEach(m => { try { m.dispose(); } catch {} });
      gridMeshesRef.current = [];
      if (!visible) return;
      const gridMat = new StandardMaterial("gridMat", scene);
      gridMat.diffuseColor = new Color3(0.30, 0.30, 0.36);
      gridMat.emissiveColor = new Color3(0.12, 0.12, 0.16);
      const spacing = 4, count = 25;
      for (let i = -count / 2; i <= count / 2; i++) {
        const x = i * spacing;
        const lx = MeshBuilder.CreateBox(`gx${i}`, { width: 0.04, height: 0.02, depth: count * spacing }, scene);
        lx.position.set(x, 0.02, 0); lx.material = gridMat; lx.isPickable = false;
        gridMeshesRef.current.push(lx);
        const lz = MeshBuilder.CreateBox(`gz${i}`, { width: count * spacing, height: 0.02, depth: 0.04 }, scene);
        lz.position.set(0, 0.02, x); lz.material = gridMat; lz.isPickable = false;
        gridMeshesRef.current.push(lz);
      }
    }
    buildGrid(gridEnabled);
    sceneRef.buildGrid = buildGrid;

    // cannon-es physics world
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) });
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;
    worldRef.current = world;
    // Static baseplate body
    const bpShape = new CANNON.Box(new CANNON.Vec3(50, 0.5, 50));
    const bpBody = new CANNON.Body({ mass: 0, shape: bpShape });
    bpBody.position.set(0, -0.5, 0);
    world.addBody(bpBody);

    let lastTime = performance.now();
    scene.registerBeforeRender(() => {
      if (!sceneRef.physicsEnabled) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      world.step(1 / 60, dt, 3);
      for (const [name, body] of Object.entries(bodiesRef.current)) {
        const mesh = meshMapRef.current[name];
        if (!mesh) continue;
        mesh.position.set(body.position.x, body.position.y, body.position.z);
        if (!mesh.rotationQuaternion) mesh.rotationQuaternion = mesh.rotation.toQuaternion();
        mesh.rotationQuaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
    });
    sceneRef.physicsEnabled = physicsEnabled;

    // Click to select
    scene.onPointerObservable.add((pi) => {
      if (pi.type !== 4) return; // POINTERUP = 4
      const hit = pi.pickInfo;
      if (!hit || !hit.hit || !hit.pickedMesh || !hit.pickedMesh.isPickable) return;
      const mesh = hit.pickedMesh;
      const hlLayer = highlightRef.current;
      if (selectedMeshRef.current && selectedMeshRef.current !== mesh) {
        try { hlLayer.removeMesh(selectedMeshRef.current); } catch {}
      }
      selectedMeshRef.current = mesh;
      hlLayer.addMesh(mesh, Color3.Yellow());
      setSelectedLabel(mesh.name);
      if (addOutput) addOutput(`🔵 Selected: ${mesh.name}`, "info");
    });

    engine.runRenderLoop(() => scene.render());
    const handleResize = () => engine.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearInterval(pollRef.current);
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Wave 5: Live Rendering Sync helpers ---
  // These run once the scene is available

  /** Create or update a Part mesh from a game event */
  const createPartMesh = useCallback((id, name, position, size, color) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const parts = partMeshesRef.current;

    // If already exists, just update position/size
    if (parts[id]) {
      const existing = parts[id];
      existing.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
      return;
    }

    const w = size?.x ?? 4;
    const h = size?.y ?? 1;
    const d = size?.z ?? 4;
    const mesh = MeshBuilder.CreateBox(`part_${id}`, { width: w, height: h, depth: d }, scene);
    mesh.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    mesh.name = name || id;
    mesh.isPickable = true;

    const mat = new StandardMaterial(`mat_part_${id}`, scene);
    // Parse hex color or use grey default
    if (color && color.startsWith("#")) {
      const r = parseInt(color.slice(1, 3), 16) / 255;
      const g = parseInt(color.slice(3, 5), 16) / 255;
      const b = parseInt(color.slice(5, 7), 16) / 255;
      mat.diffuseColor = new Color3(r, g, b);
    } else {
      mat.diffuseColor = new Color3(0.75, 0.75, 0.80);
    }
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mesh.material = mat;
    parts[id] = mesh;
    setLivePartCount(c => c + 1);
  }, []);

  /** Move a Part mesh */
  const movePartMesh = useCallback((id, position) => {
    const mesh = partMeshesRef.current[id];
    if (mesh) {
      mesh.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }
  }, []);

  /** Remove a Part mesh */
  const removePartMesh = useCallback((id) => {
    const mesh = partMeshesRef.current[id];
    if (mesh) {
      try { mesh.dispose(); } catch {}
      delete partMeshesRef.current[id];
      setLivePartCount(c => Math.max(0, c - 1));
    }
  }, []);

  /** Create a player mesh (blue capsule-ish box with label) */
  const createPlayerMesh = useCallback((name, position) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const players = playerMeshesRef.current;
    if (players[name]) {
      players[name].mesh.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
      return;
    }

    // Player body: tall blue box (2×4.5×1)
    const mesh = MeshBuilder.CreateBox(`player_${name}`, { width: 2, height: 4.5, depth: 1 }, scene);
    mesh.position.set(position.x ?? 0, (position.y ?? 5), position.z ?? 0);
    mesh.name = `Player:${name}`;
    mesh.isPickable = true;
    const mat = new StandardMaterial(`mat_player_${name}`, scene);
    mat.diffuseColor = new Color3(0.2, 0.5, 1.0);
    mat.specularColor = new Color3(0.1, 0.2, 0.4);
    mesh.material = mat;

    // Floating label above the player
    const labelMesh = _createFloatingLabel(scene, name, mesh, 3.0, new Color3(0.4, 0.7, 1.0));

    players[name] = { mesh, labelMesh };
  }, []);

  /** Move a player mesh */
  const movePlayerMesh = useCallback((name, position) => {
    const entry = playerMeshesRef.current[name];
    if (entry) {
      entry.mesh.position.set(position.x ?? 0, position.y ?? 5, position.z ?? 0);
    }
  }, []);

  /** Remove player mesh */
  const removePlayerMesh = useCallback((name) => {
    const entry = playerMeshesRef.current[name];
    if (entry) {
      try { entry.mesh.dispose(); } catch {}
      try { if (entry.labelMesh) entry.labelMesh.dispose(); } catch {}
      delete playerMeshesRef.current[name];
    }
  }, []);

  /** Create enemy mesh (red box with health bar + label) */
  const createEnemyMesh = useCallback((id, name, position, health, maxHealth) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const enemies = enemyMeshesRef.current;
    if (enemies[id]) {
      enemies[id].mesh.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
      return;
    }

    // Enemy body: red box
    const mesh = MeshBuilder.CreateBox(`enemy_${id}`, { width: 2.5, height: 3, depth: 2.5 }, scene);
    mesh.position.set(position.x ?? 0, (position.y ?? 0) + 1.5, position.z ?? 0);
    mesh.name = `Enemy:${name}`;
    mesh.isPickable = true;
    const mat = new StandardMaterial(`mat_enemy_${id}`, scene);
    mat.diffuseColor = new Color3(0.85, 0.15, 0.15);
    mat.specularColor = new Color3(0.3, 0.05, 0.05);
    mesh.material = mat;

    // Health bar (flat box above enemy, green→red)
    const hp = (health ?? 50);
    const maxHp = (maxHealth ?? 50);
    const healthBar = _createHealthBar(scene, `hbar_${id}`, mesh, hp, maxHp);

    // Floating label
    const labelMesh = _createFloatingLabel(scene, name, mesh, 2.2, new Color3(1.0, 0.4, 0.4));

    enemies[id] = { mesh, healthBar, labelMesh, health: hp, maxHealth: maxHp };
  }, []);

  /** Move an enemy mesh */
  const moveEnemyMesh = useCallback((id, position) => {
    const entry = enemyMeshesRef.current[id];
    if (entry) {
      entry.mesh.position.set(position.x ?? 0, (position.y ?? 0) + 1.5, position.z ?? 0);
    }
  }, []);

  /** Remove enemy mesh (death) */
  const removeEnemyMesh = useCallback((id) => {
    const entry = enemyMeshesRef.current[id];
    if (entry) {
      try { entry.mesh.dispose(); } catch {}
      try { if (entry.healthBar) entry.healthBar.dispose(); } catch {}
      try { if (entry.labelMesh) entry.labelMesh.dispose(); } catch {}
      delete enemyMeshesRef.current[id];
    }
  }, []);

  /** Update health bar for a target (player name or enemy id) */
  const updateHealthBar = useCallback((target, health, maxHealth) => {
    // Check enemies first
    for (const [id, entry] of Object.entries(enemyMeshesRef.current)) {
      if (entry.mesh.name.includes(target) || id === target) {
        entry.health = health;
        entry.maxHealth = maxHealth;
        _updateHealthBarMesh(entry.healthBar, health, maxHealth);
        return;
      }
    }
  }, []);

  /** Show a semi-transparent yellow attack sphere that fades out */
  const showAttackSphere = useCallback((from, radius, duration) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const sphere = MeshBuilder.CreateSphere(`atk_${Date.now()}`, { diameter: (radius ?? 5) * 2, segments: 8 }, scene);
    sphere.position.set(from?.x ?? 0, from?.y ?? 0, from?.z ?? 0);
    sphere.isPickable = false;

    const mat = new StandardMaterial(`mat_atk_${Date.now()}`, scene);
    mat.diffuseColor = new Color3(1.0, 0.9, 0.1);
    mat.alpha = 0.35;
    mat.wireframe = false;
    mat.backFaceCulling = false;
    sphere.material = mat;

    // Fade out over `duration` seconds
    const dur = (duration ?? 0.5) * 1000;
    const startTime = Date.now();
    const fadeInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / dur;
      if (progress >= 1) {
        clearInterval(fadeInterval);
        try { sphere.dispose(); } catch {}
        return;
      }
      mat.alpha = 0.35 * (1 - progress);
    }, 16);
  }, []);

  /** Clear all live-sync meshes (on game_reset) */
  const clearLiveScene = useCallback(() => {
    for (const id of Object.keys(partMeshesRef.current)) removePartMesh(id);
    for (const name of Object.keys(playerMeshesRef.current)) removePlayerMesh(name);
    for (const id of Object.keys(enemyMeshesRef.current)) removeEnemyMesh(id);
    setLivePartCount(0);
  }, [removePartMesh, removePlayerMesh, removeEnemyMesh]);

  /** Handle a single structured game event */
  const handleGameEvent = useCallback((data) => {
    switch (data.event) {
      case "part_created":
        createPartMesh(data.id, data.name, data.position ?? { x: 0, y: 0, z: 0 }, data.size ?? { x: 4, y: 1, z: 4 }, data.color ?? "#c0c0c0");
        break;
      case "part_moved":
        movePartMesh(data.id, data.position);
        break;
      case "part_removed":
        removePartMesh(data.id);
        break;
      case "player_joined":
        createPlayerMesh(data.name, data.position ?? { x: 0, y: 5, z: 0 });
        break;
      case "player_moved":
        movePlayerMesh(data.name, data.position);
        break;
      case "player_left":
        removePlayerMesh(data.name);
        break;
      case "enemy_spawned":
        createEnemyMesh(data.id, data.name, data.position ?? { x: 0, y: 0, z: 0 }, data.health ?? 50, data.maxHealth ?? 50);
        break;
      case "enemy_moved":
        moveEnemyMesh(data.id, data.position);
        break;
      case "enemy_died":
        removeEnemyMesh(data.id);
        break;
      case "health_changed":
        updateHealthBar(data.target, data.health, data.maxHealth);
        break;
      case "attack_range":
        showAttackSphere(data.from, data.radius, data.duration);
        break;
      case "game_reset":
        clearLiveScene();
        break;
      default:
        break;
    }
  }, [createPartMesh, movePartMesh, removePartMesh, createPlayerMesh, movePlayerMesh, removePlayerMesh, createEnemyMesh, moveEnemyMesh, removeEnemyMesh, updateHealthBar, showAttackSphere, clearLiveScene]);

  /** Process pending events via rAF batching (max 60fps) */
  const drainEvents = useCallback(() => {
    rafPendingRef.current = false;
    const events = pendingEventsRef.current.splice(0);
    for (const evt of events) handleGameEvent(evt);
  }, [handleGameEvent]);

  /** Enqueue a game event for next rAF */
  const enqueueEvent = useCallback((data) => {
    pendingEventsRef.current.push(data);
    if (!rafPendingRef.current) {
      rafPendingRef.current = true;
      requestAnimationFrame(drainEvents);
    }
  }, [drainEvents]);

  /** "Sync Scene" — fetch full snapshot and rebuild live meshes */
  const syncScene = useCallback(async () => {
    try {
      const res = await fetch(`${GAME_API_URL}/api/game/state/snapshot`);
      if (!res.ok) return;
      const data = await res.json();

      // Clear existing live meshes
      clearLiveScene();

      // Rebuild from snapshot
      const parts = data.parts || [];
      const players = data.players || [];
      const enemies = data.enemies || [];

      for (const p of parts) {
        createPartMesh(p.id, p.name, p.position, p.size, p.color ?? "#c0c0c0");
      }
      for (const p of players) {
        createPlayerMesh(p.name, p.position);
      }
      for (const e of enemies) {
        createEnemyMesh(e.id, e.name, e.position, e.health, e.maxHealth);
      }

      if (addOutput) addOutput(`🔄 Scene synced: ${parts.length} parts, ${players.length} players, ${enemies.length} enemies`, "info");
    } catch (e) {
      if (addOutput) addOutput(`⚠️ Sync failed: ${e.message}`, "warn");
    }
  }, [clearLiveScene, createPartMesh, createPlayerMesh, createEnemyMesh, addOutput]);

  // --- Wave 5: WebSocket connection for live events ---
  useEffect(() => {
    let ws;
    let reconnectTimer;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      try {
        ws = new WebSocket(GAME_API_URL_WS);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!destroyed) setWsConnected(true);
        };

        ws.onmessage = (event) => {
          if (destroyed) return;
          try {
            const data = JSON.parse(event.data);
            // Only handle structured game events (type = "game_event")
            if (data.type === "game_event" && data.message) {
              try {
                const payload = JSON.parse(data.message);
                if (payload && payload.event) {
                  enqueueEvent(payload);
                }
              } catch {}
            }
          } catch {
            // plain text output line — ignore for rendering
          }
        };

        ws.onclose = () => {
          if (!destroyed) {
            setWsConnected(false);
            wsRef.current = null;
            reconnectTimer = setTimeout(connect, 2000);
          }
        };

        ws.onerror = () => {
          try { ws.close(); } catch {}
        };
      } catch {
        if (!destroyed) reconnectTimer = setTimeout(connect, 2000);
      }
    }

    connect();

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        try { ws.close(); } catch {}
      }
      wsRef.current = null;
      setWsConnected(false);
    };
  }, [enqueueEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grid toggle
  useEffect(() => {
    if (sceneRef.buildGrid) sceneRef.buildGrid(gridEnabled);
  }, [gridEnabled]);

  // Physics toggle
  useEffect(() => {
    sceneRef.physicsEnabled = physicsEnabled;
  }, [physicsEnabled]);

  // Camera mode
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    if (cameraMode === "top") {
      cam.alpha = 0; cam.beta = 0.05; cam.radius = 60; cam.target = new Vector3(0, 0, 0);
    } else if (cameraMode === "fly") {
      cam.alpha = -Math.PI / 4; cam.beta = Math.PI / 2.5; cam.radius = 15;
    } else {
      cam.alpha = -Math.PI / 4; cam.beta = Math.PI / 3.5; cam.radius = 30; cam.target = new Vector3(0, 2, 0);
    }
  }, [cameraMode]);

  // Poll instances every 500ms
  useEffect(() => {
    let spawnPositionCounter = 0;

    const syncInstances = async () => {
      try {
        const res = await fetch(`${GAME_API_URL}/api/game/instances`);
        if (!res.ok) return;
        const data = await res.json();
        const scene = sceneRef.current;
        if (!scene) return;
        const allInstances = data.instances || [];

        // Only render visually relevant instances
        const renderableInstances = allInstances.filter(isRenderable);
        setInstanceCount(renderableInstances.length);

        const meshMap = meshMapRef.current;
        const bodies = bodiesRef.current;
        const world = worldRef.current;

        // Remove meshes no longer in instances
        const currentKeys = new Set(renderableInstances.map(i => i.Path || i.Name + "_" + i.ClassName));
        for (const key of Object.keys(meshMap)) {
          if (key === "__baseplate__") continue;
          if (!currentKeys.has(key)) {
            try { meshMap[key].dispose(); } catch {}
            delete meshMap[key];
            if (bodies[key]) { world.removeBody(bodies[key]); delete bodies[key]; }
          }
        }

        // Add new meshes
        renderableInstances.forEach((inst, idx) => {
          const key = inst.Path || inst.Name + "_" + inst.ClassName;
          if (meshMap[key]) return; // already rendered

          const isPlayer = isPlayerLike(inst);
          let mesh;

          // Determine spawn position
          const parsedPos = parsePosition(inst);
          let spawnX, spawnY, spawnZ;

          if (parsedPos) {
            spawnX = parsedPos.x; spawnY = parsedPos.y; spawnZ = parsedPos.z;
          } else if (isPlayer) {
            // Spread players out nicely
            const pi = spawnPositionCounter++;
            spawnX = (pi % 5 - 2) * 6;
            spawnY = 6;
            spawnZ = -12;
          } else {
            // Scatter parts in a grid pattern above the baseplate
            spawnX = ((idx % 5) - 2) * 6;
            spawnY = 4 + Math.floor(idx / 5) * 2;
            spawnZ = (Math.floor(idx / 5) - 2) * 6;
          }

          if (isPlayer) {
            // Player: tall blue box (character silhouette)
            mesh = MeshBuilder.CreateBox(inst.Name, { width: 2, height: 4.5, depth: 1 }, scene);
          } else {
            // Part: standard 4×1×2 box
            mesh = MeshBuilder.CreateBox(inst.Name, { width: 4, height: 1, depth: 2 }, scene);
          }

          mesh.position.set(spawnX, spawnY, spawnZ);
          mesh.name = inst.Name;
          mesh.isPickable = true;

          const mat = new StandardMaterial(`mat_${key}`, scene);
          if (isPlayer) {
            mat.diffuseColor = new Color3(0.2, 0.5, 1.0); // blue for players
          } else {
            mat.diffuseColor = seededColor(inst.Name); // seeded color by Name
          }
          mat.specularColor = new Color3(0.15, 0.15, 0.15);
          mesh.material = mat;
          meshMap[key] = mesh;

          // Physics body
          if (physicsEnabled && world) {
            const hw = isPlayer ? 1 : 2;
            const hh = isPlayer ? 2.25 : 0.5;
            const hd = isPlayer ? 0.5 : 1;
            const shape = new CANNON.Box(new CANNON.Vec3(hw, hh, hd));
            const body = new CANNON.Body({ mass: 1, shape });
            body.position.set(spawnX, spawnY, spawnZ);
            body.linearDamping = 0.4;
            body.angularDamping = 0.4;
            world.addBody(body);
            bodies[key] = body;
          }
        });
      } catch (e) {
        // Silently ignore network errors
      }
    };

    syncInstances();
    const interval = setInterval(syncInstances, 500);
    pollRef.current = interval;
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetCamera = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    cam.alpha = -Math.PI / 4;
    cam.beta = Math.PI / 3.5;
    cam.radius = 30;
    cam.target = new Vector3(0, 2, 0);
  }, []);

  const clearSelection = useCallback(() => {
    const hl = highlightRef.current;
    if (selectedMeshRef.current && hl) {
      try { hl.removeMesh(selectedMeshRef.current); } catch {}
    }
    selectedMeshRef.current = null;
    setSelectedLabel(null);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#14141a" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", outline: "none" }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Header badge */}
      <div style={{
        position: "absolute", top: 8, left: 8, fontSize: 10, fontFamily: "monospace",
        color: colors?.accent || "#88c0d0", background: "rgba(0,0,0,0.55)",
        padding: "2px 8px", borderRadius: 4, backdropFilter: "blur(4px)",
        border: "1px solid rgba(255,255,255,0.08)", letterSpacing: 1,
        display: "flex", gap: 8, alignItems: "center",
      }}>
        <span>3D VIEWPORT · Babylon.js</span>
        {/* Live WS indicator */}
        <span title={wsConnected ? "Live sync connected" : "Connecting..."} style={{ color: wsConnected ? "#22c55e" : "#f59e0b" }}>
          {wsConnected ? "⬤ LIVE" : "◌ SYNC"}
        </span>
        {/* Live part count from game events */}
        {livePartCount > 0 && (
          <span style={{ color: "#a78bfa", fontWeight: "bold" }}>{livePartCount} live</span>
        )}
        {/* Legacy polled instance count */}
        {instanceCount > 0 && (
          <span style={{ color: "#22c55e", fontWeight: "bold" }}>{instanceCount} polled</span>
        )}
      </div>

      {/* Selected instance overlay label */}
      {selectedLabel && (
        <div style={{
          position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.75)", color: "#fff",
          padding: "4px 14px", borderRadius: 20,
          fontSize: 12, fontFamily: "monospace",
          border: "1px solid rgba(255,255,255,0.15)",
          backdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", gap: 8,
          maxWidth: "80%",
        }}>
          <span style={{ color: "#fbbf24" }}>●</span>
          <span>{selectedLabel}</span>
          <button
            onClick={clearSelection}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 12, padding: "0 2px" }}
          >✕</button>
        </div>
      )}

      {/* Toolbar buttons */}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4, zIndex: 10 }}>
        <ViewportButton onClick={resetCamera} title="Reset Camera" label="⌖" colors={colors} />
        <ViewportButton
          onClick={syncScene}
          title="Sync Scene from VM snapshot"
          label="↺"
          colors={colors}
          active={false}
        />
        <ViewportButton
          onClick={() => {}}
          title={physicsEnabled ? "Physics On" : "Physics Off"}
          label="⚡"
          colors={colors}
          active={physicsEnabled}
        />
        <ViewportButton
          onClick={() => {}}
          title={gridEnabled ? "Grid On" : "Grid Off"}
          label="⊞"
          colors={colors}
          active={gridEnabled}
        />
      </div>
    </div>
  );
}

function ViewportButton({ onClick, title, label, colors, active }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 30, height: 30, borderRadius: 6,
        border: `1px solid ${active ? (colors?.accent || "#88c0d0") : "rgba(255,255,255,0.15)"}`,
        background: active ? `${colors?.accent || "#88c0d0"}22` : "rgba(0,0,0,0.5)",
        color: active ? (colors?.accent || "#88c0d0") : "rgba(255,255,255,0.6)",
        cursor: "pointer", fontSize: 14,
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}
