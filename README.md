# ClawBlox Studio

> **The Roblox development environment rebuilt for AI agents.**
> Write, run, test, and deploy Luau — without ever opening Roblox Studio.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey.svg)]()
[![Release](https://img.shields.io/github/v/release/archofmac-png/clawblox-studio)](https://github.com/archofmac-png/clawblox-studio/releases/latest)

---

## ⬇️ Download

| Platform | Installer | Notes |
|---|---|---|
| **Linux** | [ClawBlox-Studio-1.0.0.AppImage](https://github.com/archofmac-png/clawblox-studio/releases/download/v1.0.0/ClawBlox-Studio-1.0.0.AppImage) | Download, `chmod +x`, double-click to run |
| **Windows** | Build from source (`npm run build:win`) | Generates NSIS `.exe` installer |
| **macOS** | Build from source (`npm run build:mac`) | Generates `.dmg` |

> **Linux users:** No install needed. Just download the AppImage, make it executable, and run it.
> ```bash
> chmod +x ClawBlox-Studio-1.0.0.AppImage
> ./ClawBlox-Studio-1.0.0.AppImage
> ```

---

## What Is ClawBlox Studio?

ClawBlox Studio is a **fully local Roblox development environment** — a ground-up rebuild of Roblox Studio, optimized for AI-driven game development workflows.

It runs entirely on your machine. No Roblox account required to write and test code. AI agents (or humans) interact with it through a REST API or through the Electron desktop GUI. When you're ready to ship, it deploys directly to Roblox Open Cloud.

---

## Why ClawBlox Instead of Roblox Studio?

Roblox Studio was built for humans clicking around a GUI. ClawBlox was built for **agents that communicate through APIs**.

### The Problem with Roblox Studio for AI

| Pain Point | Roblox Studio | ClawBlox Studio |
|---|---|---|
| Automation | No API — GUI only | Full REST API on `localhost:3001` |
| Scripting | Manual file save, no watch mode | API: write → execute → read output instantly |
| Testing | No built-in test framework | Jest-like `.clawtest.lua` runner with CI-friendly output |
| Offline dev | Requires Roblox network connection | Fully offline — Lua VM runs locally |
| Headless mode | Not possible | API server runs without any display |
| Instance introspection | Click through UI panels | `GET /api/game/instances` — full instance tree as JSON |
| Build verification | Manual | Integrated `selene` lint + `luau-analyze` type check |
| Deploy | Manual drag-and-drop | `POST /api/deploy` — pushes to Roblox Open Cloud |
| Cost | Free (but cloud-dependent) | Free, runs on any Node.js machine |
| Multi-agent workflows | Impossible | Multiple agents can hit the API concurrently |

**Bottom line:** An AI agent cannot click. ClawBlox gives it a keyboard and an API.

---

## Features

### ✅ What's Fully Implemented

#### Core Engine
- **Lua 5.4 VM** — wasmoon-powered WebAssembly Lua, not a stub
- **Instance.new() bridge** — Lua instances register in JS registry; readable via API
- **CFrame** — Full rotation matrix, `CFrame.Angles()`, `CFrame * CFrame` multiply, `.Position`
- **Color3, Vector3, UDim2, TweenInfo** — All standard value types
- **require()** — Module system resolves ModuleScripts by path, cached after first load
- **WedgePart / Part.Shape** — `"Block"` and `"Wedge"` geometry with rotation in events

#### Roblox Services (Mocked)
| Service | Status | Key Methods |
|---|---|---|
| Players | ✅ | PlayerAdded/Removing, Character, Humanoid, leaderstats |
| Workspace | ✅ | FindFirstChild, WaitForChild, GetDescendants, SphereCast |
| ReplicatedStorage | ✅ | FindFirstChild, WaitForChild (async) |
| DataStoreService | ✅ | GetAsync, SetAsync, UpdateAsync, RemoveAsync (in-memory) |
| CollectionService | ✅ | GetTagged, AddTag, HasTag, GetInstanceAddedSignal |
| RunService | ✅ | Heartbeat/Stepped at real Hz, IsServer/IsClient |
| TweenService | ✅ | TweenInfo, Create, Play/Stop/Cancel, Completed event |
| UserInputService | ✅ | Keyboard/mouse simulation |
| Debris | ✅ | AddItem with TTL |
| HttpService | ✅ | JSONEncode/Decode, GetAsync stub |
| MessagingService | ✅ | PublishAsync/SubscribeAsync mock |
| PathfindingService | ✅ | A* grid pathfinding, obstacle avoidance |
| PhysicsService | ✅ | CreateCollisionGroup, SetPartCollisionGroup |
| NetworkBridge | ✅ | Per-player client VMs, RemoteEvent FireClient/FireServer |

#### 3D Viewport
- **Babylon.js rendering** — Parts created in Lua appear in the viewport in real time
- **cannon-es physics** — Gravity, collision detection, body sync
- **ArcRotateCamera** — Orbit, pan, zoom
- **Instance sync** — Part meshes, player boxes (blue), enemy boxes (red) with health bars
- **Attack sphere** — Yellow transparent sphere rendered on SphereCast calls
- **Live WebSocket** — ⬤ LIVE indicator, auto-reconnect, 60fps render batching

#### Test Framework
- **`.clawtest.lua` format** — `describe()`, `it()`, `expect()` blocks
- **Assertions** — `toBe`, `toBeNil`, `toBeGreaterThan`, `toBeTruthy`, `toMatch`, `toBeNotNil`
- **Test Runner UI** — 🧪 Tests tab in Electron app
- **API runner** — `POST /api/test/run` returns pass/fail counts, errors, timing (CI-friendly)

#### Deploy Pipeline
- **`.rbxlx` export** — Valid Roblox place file XML with Script/LocalScript/ModuleScript instances
- **Roblox Open Cloud push** — `POST /api/deploy` uploads to Roblox's live publishing API
- **Deploy history** — Last 10 deploys logged in `deploy-history.json`
- **🚀 Deploy button** — One-click deploy from the Electron toolbar

#### Scene Persistence
- `POST /api/project/save` — Save scene snapshot
- `GET /api/project/load/:id` — Restore scene state
- `GET /api/project/changelog/:id` — Per-project changelog with delta tracking (added/removed/modified, KB size)
- `GET /api/project/list` — List all saved projects

#### Physics & Pathfinding
- **cannon-es integration** — Part bodies registered automatically on `Instance.new("Part")`
- **SphereCast** — AABB vs swept-sphere detection via `workspace:SphereCast()`
- **A\* Pathfinding** — Grid-based pathfinding with obstacle avoidance
- **API:** `/api/physics/spherecast`, `/api/physics/step`, `/api/pathfinding/find`, `/api/pathfinding/move-agent`

#### Code Quality
- **selene 0.30.1** — Luau linter with Roblox stdlib (`std = "roblox"`)
- **luau-analyze 0.711** — Roblox type checker
- Both run pre-deploy as a verification gate

#### Electron Desktop App
- **Monaco Editor** — Luau syntax highlighting, Roblox autocomplete
- **Explorer panel** — Full instance tree with icons, drag-to-reparent
- **Properties panel** — Click → see all properties → edit live
- **Output console** — Color-coded, timestamped, source file + line
- **Command bar** — Execute Lua directly (like Studio's command bar)
- **Find/Replace** — Across all project scripts
- **Cross-platform build** — AppImage, `.deb`, `.dmg`, Windows NSIS installer

---

### ❌ What's Not in ClawBlox (Yet)

These are Roblox Studio features not yet implemented — gaps vs the real thing:

| Missing Feature | Notes |
|---|---|
| **Terrain editor** | No voxel terrain system — flat baseplate only |
| **Plugin system** | Roblox Studio plugins not supported |
| **AnimationEditor** | No keyframe animation tooling |
| **Team Create / real-time collaboration** | Single-user only for now |
| **Sound / audio playback** | SoundService is a stub |
| **Marketplace / toolbox** | No free model browser |
| **Live game observation** | No "Watch" mode to attach to a live place |
| **Client ↔ server simulation parity** | Network bridge mocks RemoteEvents but doesn't fully replicate Roblox's replication model |
| **ScreenGui / SurfaceGui rendering** | GUI instances exist in the instance tree but are not rendered in the viewport |
| **Streaming enabled** | No spatial streaming simulation |
| **VR support** | Not planned |

---

## Use Cases

### ✅ Best For
- **AI agent game development** — Agents write and test Lua, read results via API, iterate without human involvement
- **Automated testing pipelines** — CI/CD for Roblox game logic with `.clawtest.lua` files
- **Script-heavy development** — Combat systems, inventory, economy, quests, datastores
- **World building automation** — Swarm agents building and placing instances at scale
- **Offline development** — No internet needed to write and test Lua
- **Headless server runs** — `npm run api` starts the engine without a display

### ⚠️ Not Ideal For
- **GUI-heavy games** — ScreenGui/SurfaceGui not rendered
- **Terrain-first games** — No voxel terrain tooling
- **Plugin development** — Studio plugins won't run here
- **Final polish** — Always do a final pass in Roblox Studio before publishing

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLAWBLOX STUDIO                      │
│                                                         │
│  ┌──────────────────┐    ┌────────────────────────────┐ │
│  │   ELECTRON GUI   │    │    API SERVER (port 3001)  │ │
│  │  React + Vite    │◄──►│  Express + TypeScript      │ │
│  │  Monaco Editor   │    │  wasmoon Lua 5.4 VM        │ │
│  │  Babylon.js 3D   │    │  Roblox Service Mocks      │ │
│  │  Explorer Panel  │    │  File Manager + Git        │ │
│  │  Test Runner     │    │  WebSocket (port 3002)     │ │
│  │  Deploy UI       │    │  Physics (cannon-es)       │ │
│  └──────────────────┘    │  A* Pathfinding            │ │
│                          │  Test Framework            │ │
│                          │  Scene Persistence         │ │
│                          └────────────┬───────────────┘ │
│                                       │                 │
│                                       ▼                 │
│                           ┌─────────────────────┐       │
│                           │  Roblox Open Cloud  │       │
│                           │  Deploy API         │       │
│                           └─────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Human Usage — Installer (Recommended)

**Linux:** Download the AppImage from the [Releases page](https://github.com/archofmac-png/clawblox-studio/releases/latest), then:
```bash
chmod +x ClawBlox-Studio-1.0.0.AppImage
./ClawBlox-Studio-1.0.0.AppImage
```

**Windows/macOS:** Build from source (see below) — generates a native installer.

### Human Usage — Build From Source

```bash
git clone https://github.com/archofmac-png/clawblox-studio.git
cd clawblox-studio
npm install
npm run dev        # Launches Electron app (GUI + API server)
```

### AI Agent Usage (Headless API)

```bash
npm run api        # Starts API server only on port 3001 (no display needed)
```

Then communicate via HTTP:

```bash
# Execute Lua
curl -X POST http://localhost:3001/api/game/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "local p = Instance.new(\"Part\"); p.Name = \"TestPart\"; print(p.Name)"}'

# List all instances
curl http://localhost:3001/api/game/instances

# Run tests
curl -X POST http://localhost:3001/api/test/run

# Deploy to Roblox
curl -X POST http://localhost:3001/api/deploy \
  -H "Content-Type: application/json" \
  -d '{"universeId": "YOUR_UNIVERSE_ID", "apiKey": "YOUR_ROBLOX_API_KEY"}'
```

---

## Build Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Electron in dev mode (hot reload) |
| `npm run api` | Start API server only (headless) |
| `npm run build` | Build for production |
| `npm run build:win` | Build Windows installer (NSIS) |
| `npm run build:linux` | Build Linux AppImage + `.deb` |
| `npm run build:mac` | Build macOS DMG |

---

## Full API Reference

See [`CLAWBLOX_USER_GUIDE.md`](CLAWBLOX_USER_GUIDE.md) for the complete REST API documentation, including all endpoints, request/response schemas, and agent usage patterns.

### Key Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server health check |
| POST | `/api/game/start` | Start the Lua VM |
| POST | `/api/game/stop` | Stop the Lua VM |
| POST | `/api/game/execute` | Execute Lua code |
| GET | `/api/game/instances` | Get full instance tree as JSON |
| POST | `/api/game/simulate` | Simulate a game tick |
| POST | `/api/game/test` | Run named test scenario |
| GET | `/api/game/state/snapshot` | Full live state snapshot |
| POST | `/api/test/run` | Run all `.clawtest.lua` test files |
| POST | `/api/deploy` | Export `.rbxlx` + push to Roblox Open Cloud |
| GET | `/api/deploy/history` | Last 10 deploy records |
| POST | `/api/project/save` | Save scene snapshot |
| GET | `/api/project/load/:id` | Load saved scene |
| GET | `/api/project/list` | List all projects |
| POST | `/api/physics/spherecast` | SphereCast overlap detection |
| POST | `/api/physics/step` | Advance physics simulation |
| POST | `/api/pathfinding/find` | Compute A* path |
| POST | `/api/pathfinding/move-agent` | Move agent along path |
| POST | `/api/network/add-client` | Add a client VM |
| POST | `/api/network/fire-client` | Fire RemoteEvent to client |
| POST | `/api/network/fire-server` | Fire RemoteEvent to server |

---

## System Requirements

| Requirement | Minimum |
|---|---|
| OS | Linux, Windows 10+, macOS 11+ |
| Node.js | 18+ |
| npm | 8+ |
| RAM | 4GB recommended |
| Disk | ~500MB (including node_modules) |
| Display | Required for Electron GUI; NOT required for headless API mode |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Electron |
| Frontend | React + Vite + TailwindCSS |
| Code editor | Monaco Editor |
| 3D engine | Babylon.js |
| Physics | cannon-es |
| Lua VM | wasmoon (Lua 5.4 WASM) |
| Backend | Express + TypeScript |
| Real-time output | WebSocket (ws) |
| Linting | selene 0.30.1 |
| Type checking | luau-analyze 0.711 |
| Deploy | Roblox Open Cloud API |

---

## License

MIT — use it, fork it, build on it.
