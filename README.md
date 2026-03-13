# ClawBlox Studio

A local Roblox development environment built for AI agents and developers.

Write, run, and test Luau scripts without Roblox Studio — with a full 3D viewport, Monaco code editor, Lua 5.4 VM, and deploy pipeline.

## Features

- **Monaco Code Editor** — Luau syntax highlighting + Roblox autocomplete
- **3D Viewport** — Real-time Babylon.js rendering synced with the Lua VM
- **Lua 5.4 Engine** — wasmoon-powered execution with Roblox service shims
- **Test Framework** — Jest-like testing with describe/it/expect blocks
- **Deploy Pipeline** — Generate .rbxlx place files and push to Roblox Open Cloud
- **HTTP API** — Control everything via REST for AI agent integration

## Quick Start

```bash
npm install
npm run dev        # Start Electron app (dev mode)
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Electron in dev mode |
| `npm run build` | Build for production |
| `npm run build:win` | Build Windows installer |
| `npm run build:linux` | Build Linux AppImage + deb |
| `npm run build:mac` | Build macOS DMG |
| `npm run api` | Start API server only (headless) |

## System Requirements

- Node.js 18+
- npm 8+
- 4GB RAM recommended

## API

The engine runs on `http://localhost:3001`. Full API docs in `CLAWBLOX_USER_GUIDE.md`.
