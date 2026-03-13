# ClawBlox Studio — User & Agent Guide

> Version: 1.1.0 | Status: Complete | Last updated: 2026-03-12

A local Roblox development environment that lets you write, run, and test Luau scripts without Roblox Studio. Designed to be operated by both humans and AI agents via HTTP API.

---

## What Is ClawBlox Studio?

ClawBlox Studio is an open-source alternative to Roblox Studio that runs entirely locally. It provides:

- **Monaco Code Editor** — Professional-grade editor with Luau syntax highlighting and Roblox autocomplete
- **3D Viewport** — Real-time Babylon.js rendering synced with the Lua VM
- **Lua 5.4 Engine** — Full wasmoon-powered Lua execution with Roblox service shims
- **Test Framework** — Jest-like testing with describe/it/expect blocks
- **Deploy Pipeline** — Generate .rbxlx place files and push to Roblox Open Cloud
- **HTTP API** — Control everything via REST endpoints for AI agent integration

Unlike Roblox Studio, ClawBlox runs headlessly (API server) and with a GUI (Electron). It's designed for AI agents to automate game development workflows, but fully usable by humans through its Electron interface.

---

## Can You Use It Without an AI Agent?

**Yes, absolutely.** ClawBlox Studio is a fully functional desktop application that requires no AI agent to use.

### Human Usage
- Clone the repo
- Run `npm install` in the project directory
- Run `npm run dev` to start the application
- Use the Electron GUI for all features (editor, 3D view, tests, deploy)

### AI Agent Usage (Optional)
AI agents can control ClawBlox via the HTTP API for automation. This is optional — the app works completely standalone.

---

## System Requirements

| Requirement | Minimum |
|-------------|---------|
| OS | Linux, Windows 10+, macOS 11+ |
| Node.js | 18+ |
| npm | 8+ |
| RAM | 4GB recommended |
| Disk | ~500MB |
| Display | Required for Electron GUI (X server on Linux) |

The API server can run headlessly on servers without a display. The Electron GUI requires a display server.

---

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/clawblox-studio.git
cd clawblox-studio
```

The repository is a unified single directory:

```
clawblox-studio/
  src/
    main-zuki/          # Electron main process
    renderer-zuki/      # React/Vite frontend (Electron renderer)
    api/
      server.ts         # Express API + all routes
    services/
      game-engine.ts    # wasmoon Lua VM + Roblox shims
      test-runner.ts    # Test harness
  clawblox-projects/    # User projects
  tests/                # Example test files
  package.json          # Single package — backend + Electron bundled
```

### Step 2: Install Dependencies

```bash
npm install
```

That's it — one install covers the backend server, Electron main process, and React frontend.

### Step 3: Start the Application

```bash
npm run dev
```

This starts:
- Backend API server on http://localhost:3001
- WebSocket server on ws://localhost:3002
- Vite dev server on http://localhost:5175
- Electron app window

### Step 4: Verify It's Working

```bash
# Check API
curl http://localhost:3001/api/health

# Expected: {"status":"ok","timestamp":"..."}
```

---

## Application Architecture

```
┌─────────────────────────────────────────────────┐
│              Electron (Zuki)                     │
│  ┌─────────┬──────────┬──────────┬───────────┐  │
│  │ Monaco  │ Explorer │Properties│ 3D View   │  │
│  │ Editor  │  Panel   │  Panel   │(Babylon)  │  │
│  └────┬────┴────┬─────┴────┬─────┴─────┬─────┘  │
│       │         │          │           │         │
└───────┼─────────┼──────────┼───────────┼─────────┘
        │  HTTP (port 3001)  │   WS (port 3002)
┌───────▼─────────────────────────────────────────┐
│         ClawBlox API Server (Express)            │
│  ┌─────────────────────────────────────────────┐ │
│  │         wasmoon Lua 5.4 VM                  │ │
│  │  game  workspace  Players  DataStore  ...   │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Ports:**
- 3001 — HTTP API (Express)
- 3002 — WebSocket (live output streaming)
- 5175 — Vite dev server (React)
- Electron GUI — opens automatically

---

## Using the GUI

### Monaco Editor
- Write and edit .lua/.luau files
- Syntax highlighting for Luau
- Roblox API autocomplete
- Save with Ctrl+S / Cmd+S

### Explorer Panel
- Shows project file tree
- Click files to open in editor
- Right-click to create/delete files

### Properties Panel
- Click any instance in Explorer to see properties
- Shows ClassName, Name, custom properties

### 3D Viewport
- Orbit: Click + drag
- Pan: Right-click + drag
- Zoom: Scroll wheel
- Shows Parts, player boxes, workspace hierarchy
- Click objects to select

### Output Panel
- Shows print(), warn(), error() from Lua
- WebSocket streams in real-time
- Clear button to reset

### Command Bar
- Run single Lua commands instantly
- Press Enter to execute

### Test Runner (🧪)
- Click Tests icon in sidebar
- Select a .clawtest.lua file
- Click "Run Selected"
- Results show pass/fail per test

### Deploy (🚀)
- Click Deploy button in toolbar
- Select project to deploy
- Generates .rbxlx file
- Shows deploy status in Output panel

---

## Writing Scripts

### File Types
- `.lua` — Standard Lua scripts
- `.luau` — Luau (Roblox-flavored Lua) scripts
- Scripts are loaded in order defined by project

### Roblox Globals Available

These are shimmed in the Lua VM:

| Global | Description |
|--------|-------------|
| `game` | Main game instance |
| `workspace` | Workspace service |
| `Players` | Player management |
| `ReplicatedStorage` | Replication storage |
| `ReplicatedFirst` | First-replicated assets |
| `ServerStorage` | Server-only storage |
| `ServerScriptService` | Server scripts |
| `DataStoreService` | Data persistence |
| `RunService` | Runtime info |
| `TweenService` | Tween animations |
| `Debris` | Object cleanup |
| `CollectionService` | Tag management |
| `RemoteEvent` | Client-server events (shimmed) |
| `RemoteFunction` | Client-server calls (shimmed) |

### Limitations vs Real Roblox

| Feature | Status |
|---------|--------|
| Lua 5.4 execution | ✅ Works |
| Instance creation (Instance.new) | ✅ Works |
| print/warn/error | ✅ Works |
| DataStore (in-memory) | ✅ Works |
| Physics (cannon-es approximation) | ⚠️ Partial |
| Real Roblox rendering | ❌ No |
| RemoteEvents/RemoteFunctions | ⚠️ Shimmed only |
| Real player clients | ❌ No |
| Multiplayer networking | ❌ No |

---

## Writing Tests (.clawtest.lua)

### Format

```lua
describe("Feature Name", function()
  it("should do something", function()
    -- test code
    expect(actual):toBe(expected)
  end)
end)
```

### Available Assertions

| Assertion | Description |
|-----------|-------------|
| `expect(value):toBe(expected)` | Strict equality |
| `expect(value):toEqual(expected)` | Deep equality |
| `expect(value):toBeNil()` | Value is nil |
| `expect(value):toBeNotNil()` | Value exists |
| `expect(value):toBeGreaterThan(n)` | Number comparison |
| `expect(value):toBeLessThan(n)` | Number comparison |
| `expect(value):toBeTruthy()` | Truthy check |
| `expect(value):toBeFalsy()` | Falsy check |
| `expect(value):toMatch(pattern)` | String pattern match |
| `expect(value):toContain(item)` | Array/string contains |
| `expect(value):toBeCloseTo(expected, precision)` | Floating point comparison |
| `expect(value):toBeNaN()` | Value is NaN |
| `expect(value):toBeFinite()` | Value is finite |

### Running Tests

**Via UI:**
1. Click Tests icon in sidebar
2. Select a .clawtest.lua file
3. Click "Run Selected"

**Via API:**
```bash
curl -X POST http://localhost:3001/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/tests/my-test.clawtest.lua"}'
```

**Ad-hoc (write and run immediately):**
```bash
curl -X POST http://localhost:3001/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"code": "describe(\"test\", function() it(\"works\", function() expect(1+1):toBe(2) end) end)"}'
```

---

## HTTP API Reference

Base URL: `http://localhost:3001`

### Health Check
```bash
GET /api/health
```
Response: `{"status":"ok","timestamp":"2026-03-12T..."}`

### Game Engine

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/game/state` | GET | Get engine state (stopped/running) |
| `/api/game/state/snapshot` | GET | Full snapshot of live player/enemy state |
| `/api/game/start` | POST | Start the game engine |
| `/api/game/stop` | POST | Stop the game engine |
| `/api/game/execute` | POST | Run Lua code |
| `/api/game/instances` | GET | List all instances |
| `/api/game/simulate` | POST | Simulate player actions |
| `/api/game/simulate-player` | POST | Advanced player simulation |
| `/api/game/create-part` | POST | Create a Part |
| `/api/game/workspace` | GET | Get workspace tree |
| `/api/game/test` | POST | Run single assertion |
| `/api/game/debug` | GET | Engine debug info |

**Execute Lua:**
```bash
curl -X POST http://localhost:3001/api/game/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "print(\"Hello\"); return 42"}'
```

**Get Instances:**
```bash
curl http://localhost:3001/api/game/instances
```

**Simulate Player:**
```bash
curl -X POST http://localhost:3001/api/game/simulate \
  -H "Content-Type: application/json" \
  -d '{"action": "join", "playerName": "TestPlayer"}'
```

**Get Game State Snapshot:**
```bash
curl http://localhost:3001/api/game/state/snapshot
```

**Engine Debug Info:**
```bash
curl http://localhost:3001/api/game/debug
```

### Physics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/physics/bodies` | GET | List all physics bodies |
| `/api/physics/spherecast` | POST | Sphere raycast |
| `/api/physics/step` | POST | Advance physics simulation one step |

**List Physics Bodies:**
```bash
curl http://localhost:3001/api/physics/bodies
```

**Sphere Raycast:**
```bash
curl -X POST http://localhost:3001/api/physics/spherecast \
  -H "Content-Type: application/json" \
  -d '{"origin": {"x": 0, "y": 10, "z": 0}, "direction": {"x": 0, "y": -1, "z": 0}, "radius": 2}'
```

**Step Physics:**
```bash
curl -X POST http://localhost:3001/api/physics/step \
  -H "Content-Type: application/json" \
  -d '{"deltaTime": 0.016}'
```

### Files

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/files/:projectId` | GET | List files in project |
| `/api/files/:projectId?path=...` | GET | Get file content |
| `/api/files/:projectId` | PUT | Save file |

### Projects

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List all projects |
| `/api/projects` | POST | Create project |
| `/api/projects/:id` | GET | Get project details |
| `/api/projects/:id` | DELETE | Delete project |
| `/api/projects/:id/files` | GET | List files in project |
| `/api/projects/:id/files` | POST | Create file |
| `/api/projects/:id/files/bulk` | POST | Bulk create files |
| `/api/projects/:id/files/rename` | POST | Rename file |
| `/api/projects/:id/files` | DELETE | Delete file |
| `/api/projects/:id/search` | GET | Search files |
| `/api/projects/:id/export` | GET | Export project |

**Get Project Details:**
```bash
curl http://localhost:3001/api/projects/fractured-realms
```

**List Project Files:**
```bash
curl http://localhost:3001/api/projects/fractured-realms/files
```

**Search Files:**
```bash
curl "http://localhost:3001/api/projects/fractured-realms/search?q=function"
```

**Export Project:**
```bash
curl http://localhost:3001/api/projects/fractured-realms/export
```

### Git Integration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects/:id/git/log` | GET | Commit history |
| `/api/projects/:id/git/diff` | GET | Uncommitted changes |
| `/api/projects/:id/git/status` | GET | Working tree status |
| `/api/projects/:id/git/branches` | GET | List branches |
| `/api/projects/:id/git/commit` | POST | Commit changes |
| `/api/projects/:id/git/branch` | POST | Create branch |
| `/api/projects/:id/git/checkout` | POST | Switch branch |

**View Commit History:**
```bash
curl http://localhost:3001/api/projects/fractured-realms/git/log
```

**Check Working Tree Status:**
```bash
curl http://localhost:3001/api/projects/fractured-realms/git/status
```

**View Uncommitted Diff:**
```bash
curl http://localhost:3001/api/projects/fractured-realms/git/diff
```

**List Branches:**
```bash
curl http://localhost:3001/api/projects/fractured-realms/git/branches
```

**Commit Changes:**
```bash
curl -X POST http://localhost:3001/api/projects/fractured-realms/git/commit \
  -H "Content-Type: application/json" \
  -d '{"message": "Added village houses"}'
```

**Create Branch:**
```bash
curl -X POST http://localhost:3001/api/projects/fractured-realms/git/branch \
  -H "Content-Type: application/json" \
  -d '{"name": "feature/dungeon-zone"}'
```

**Switch Branch:**
```bash
curl -X POST http://localhost:3001/api/projects/fractured-realms/git/checkout \
  -H "Content-Type: application/json" \
  -d '{"branch": "feature/dungeon-zone"}'
```

### Scene Persistence

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/project/save` | POST | Save current scene with message |
| `/api/project/load/:id` | POST | Load a saved scene |
| `/api/project/changelog/:id` | GET | Get save history |
| `/api/project/list` | GET | List all projects |

**Save a Scene:**
```bash
curl -X POST http://localhost:3001/api/project/save \
  -H "Content-Type: application/json" \
  -d '{"projectId": "fractured-realms", "message": "Added village houses"}'
```

**Response:**
```json
{
  "success": true,
  "saveId": 3,
  "message": "Added village houses",
  "timestamp": "2026-03-12T03:00:00Z",
  "sizeKB": 142.5
}
```

**Load a Scene:**
```bash
curl -X POST http://localhost:3001/api/project/load/3 \
  -H "Content-Type: application/json" \
  -d '{"projectId": "fractured-realms"}'
```

**View Changelog:**
```bash
curl http://localhost:3001/api/project/changelog/fractured-realms
```

### Tests

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/test/files` | GET | List test files |
| `/api/test/run` | POST | Run test file |

### Deploy

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/deploy` | POST | Deploy project to .rbxlx |
| `/api/deploy/history` | GET | Get deploy history |

**Deploy:**
```bash
curl -X POST http://localhost:3001/api/deploy \
  -H "Content-Type: application/json" \
  -d '{"projectPath": "/path/to/project", "universeId": "123456"}'
```

### WebSocket

Connect to `ws://localhost:3002` for live output.

```javascript
const ws = new WebSocket('ws://localhost:3002');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`[${data.type}] ${data.message}`);
};
```

Message format:
```json
{"type": "print", "message": "Hello from Lua"}
{"type": "warn", "message": "Warning message"}
{"type": "error", "message": "Error message"}
{"type": "output", "message": "Result output"}
```

---

## AI Agent Integration

### How AI Agents Use ClawBlox

AI agents can fully control ClawBlox via the HTTP API:

1. **Start the engine:**
```bash
curl -X POST http://localhost:3001/api/game/start
```

2. **Execute scripts:**
```bash
curl -X POST http://localhost:3001/api/game/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "-- Your game code here"}'
```

3. **Inspect state:**
```bash
curl http://localhost:3001/api/game/instances
```

4. **Run tests:**
```bash
curl -X POST http://localhost:3001/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/test.clawtest.lua"}'
```

5. **Deploy:**
```bash
curl -X POST http://localhost:3001/api/deploy \
  -H "Content-Type: application/json" \
  -d '{"projectPath": "/path/to/project"}'
```

### AI Agent Checklist

When an AI agent starts a session with ClawBlox:

- [ ] Verify API health: `GET /api/health`
- [ ] Start game engine: `POST /api/game/start`
- [ ] Execute initial scripts to set up game state
- [ ] Use `/api/game/instances` to verify instance tree
- [ ] Run tests to validate behavior
- [ ] Deploy when ready

---

## Deploying to Roblox

### Current Status

- ✅ Generates valid .rbxlx XML place files
- ⚠️ Roblox Open Cloud API returns 400 (expects binary .rbxl, not XML)
- ✅ Manual workaround: open .rbxlx in Roblox Studio to publish

### Manual Deploy (Recommended for Now)

1. Generate .rbxlx via API
2. Download the file
3. Open in Roblox Studio
4. Publish to your place

### Roblox API Key Setup

Set environment variable before starting server:
```bash
export ROBLOX_API_KEY="your-api-key-here"
npm run dev
```

Get API key from: https://create.roblox.com/credentials

---

## Building for Distribution

### Development Mode
```bash
cd clawblox-studio
npm run dev
```

### Production Build (Creates Installers)

```bash
cd clawblox-studio
npm run build:win    # Windows NSIS installer (.exe)
npm run build:linux  # Linux AppImage + .deb
npm run build:mac    # macOS DMG (.dmg)
```

Output goes to `dist-electron/`:
- Linux: .AppImage, .deb
- Windows: .exe (NSIS installer)
- macOS: .dmg

### What's In the Package

electron-builder bundles:
- Electron runtime
- React frontend (minified)
- Backend server (in extraResources)
- Auto-start script that spawns backend on launch

End users download one installer and run — no Node.js required.

---

## World Builder Workflow

ClawBlox is designed for AI agents to build game worlds. Here's the workflow:

### 1. Agent Plans the Build

Agent reads WORLD_POSITIONING.md to find available slots:
- Check zone boundaries
- Find next available building position
- Verify no collision with existing structures

### 2. Agent Writes Builder Script

```lua
-- BuildMedievalHouse.lua
local function buildHouseAt(x, y, z, theme, rotation)
    -- Create walls, roof, door, window
    -- Uses Instance.new("Part"), CFrame, Vector3
    -- Returns folder with all instances
end

-- Build at position from WORLD_POSITIONING
local house = buildHouseAt(60, 0, 40, "Luminara", 0)
```

### 3. Agent Executes in ClawBlox

```bash
curl -X POST http://localhost:3001/api/game/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "$(cat BuildMedievalHouse.lua)"}'
```

The script runs in the VM. Instances appear in the 3D viewport.

### 4. Agent Verifies in 3D Viewport

- Check positions look correct
- Verify no overlaps
- Review in Babylon.js viewport

### 5. Agent Saves Scene

```bash
curl -X POST http://localhost:3001/api/project/save \
  -H "Content-Type: application/json" \
  -d '{"projectId": "fractured-realms", "message": "Built House_A6 at StarterVillage"}'
```

### 6. Export to .rbxlx

When ready for Roblox Studio:
```bash
curl -X POST http://localhost:3001/api/deploy \
  -H "Content-Type: application/json" \
  -d '{"projectId": "fractured-realms", "format": "rbxlx"}'
```

This generates a .rbxlx file you can drag into Roblox Studio — all buildings placed!

---

## Troubleshooting

### API server won't start
```bash
# Check if port 3001 is in use
lsof -i :3001

# Kill existing process
pkill -f "tsx.*server"

# Restart
npm run dev
```

### 3D viewport is blank
- Ensure game engine is started: `POST /api/game/start`
- Check instances: `GET /api/game/instances`
- If empty, run some Lua to create Parts

### Tests failing unexpectedly
- DataStore is in-memory — restart engine between test runs
- `POST /api/game/stop` then `POST /api/game/start` to reset

### Deploy returns 400 from Roblox
Known issue: Open Cloud wants binary .rbxl format. Use manual workaround:
1. Generate .rbxlx via API
2. Open in Roblox Studio
3. Publish manually

### Electron won't open (headless server)
Normal. Electron requires a display. Options:
- Run on a desktop with display
- Use Xvfb: `xvfb-run npm run dev`
- Use API server only (headless mode works fine)

---

## Contributing

PRs welcome. Guidelines:
- Use TypeScript for backend
- Use React/JSX for frontend
- Test files use describe/it/expect format
- Run `npm run build:linux` (or appropriate platform target) before submitting
- Update this guide if adding features

---

## License

MIT — free to use, modify, and distribute. Attribution appreciated.
