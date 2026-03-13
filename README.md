# ClawBlox Studio

> Version 1.1.0 · Local Roblox development environment for AI agents and humans

[![Version](https://img.shields.io/badge/version-1.1.0-blue)]()
[![Node](https://img.shields.io/badge/node-18+-green)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

---

## What Is ClawBlox Studio?

ClawBlox Studio is a fully local Roblox development environment built for both AI agents and human developers. It runs an Electron desktop GUI alongside a headless Express API server, powered by a wasmoon Lua 5.4 VM with Roblox service shims — so you can write, test, and iterate on Luau without ever opening Roblox Studio. AI agents interact through a structured REST + WebSocket API, while humans get a Monaco-based editor, live 3D viewport, and one-click deploy to Roblox Open Cloud.

---

## Feature Highlights

- 🖥️ **Editor** — Monaco editor with Luau syntax highlighting and Roblox autocomplete
- 🌐 **3D Viewport** — Babylon.js real-time rendering synced with the Lua VM instance tree
- 🔬 **Observability** — Structured state snapshots, typed WebSocket events (`instance_created`, `physics_tick`, `console:structured`), screenshot capture
- 🎲 **Deterministic Mode** — Seeded RNG for reproducible Lua execution, trajectory export/replay (JSONL)
- 🤖 **Multi-Agent Sessions** — Up to 64 isolated concurrent Lua VMs, cross-session messaging bridge
- 📋 **OpenAPI 3.1** — Full API spec at `/api/openapi.json`, YAML mirror at `/api/openapi.yaml`
- 🧪 **Test Framework v2** — `describe/it/expect`, `state_match`, `performance`, `reward_hook`, batch runner, coverage report
- 🐳 **Docker + CLI** — `docker run`, `clawblox` CLI with `run/execute/test/session/status` subcommands
- 🐛 **Advanced Debugging** — Breakpoints, step/continue, hot-reload, `inject_lua`, VM interrupt, CPU profiling, structured errors
- 📦 **SDKs** — `clawblox-ts` (TypeScript) and `clawblox-py` (Python) with `ClawBloxAgent` RL interface

---

## Quick Start

### Option A: Electron Desktop App

```bash
git clone https://github.com/archofmac-png/clawblox-studio
cd clawblox-studio
npm install
npm run dev
```

### Option B: Headless API Server

```bash
npm run api
# API: http://localhost:3001
# WS:  ws://localhost:3002
```

### Option C: Docker

```bash
docker build -t clawblox-studio .
docker run -p 3001:3001 -p 3002:3002 clawblox-studio
```

---

## CLI Usage

```bash
npm install -g .

clawblox status
clawblox execute my-script.lua --deterministic --seed=42
clawblox test tests/ --batch --parallel --output=pretty
clawblox session list
clawblox session create --label=my-agent --deterministic
```

---

## For AI Agents

ClawBlox Studio is designed from the ground up to support AI-driven Roblox development. Agents get isolated Lua VM sessions, deterministic execution, structured state observations, and a clean RL-style interface.

### TypeScript — `clawblox-ts`

```bash
npm install clawblox-ts
```

```typescript
import { ClawBloxAgent } from 'clawblox-ts';

const agent = new ClawBloxAgent({ deterministic: true, seed: 42 });
let state = await agent.reset();

for (let step = 0; step < 1000; step++) {
  const action = policy(state); // your policy here
  const { state: next, done } = await agent.step(action);
  state = next;
  if (done) state = await agent.reset();
}
await agent.destroy();
```

### Python — `clawblox-py`

```bash
pip install clawblox-py
```

```python
from clawblox import ClawBloxAgent

agent = ClawBloxAgent(deterministic=True, seed=42)
state = agent.reset()

for step in range(1000):
    action = policy(state)  # your policy here
    result = agent.step(action)
    state = result.state
    if result.done:
        state = agent.reset()

agent.destroy()
```

### Multi-Agent Sessions

```typescript
import { ClawBloxClient, ClawBloxSession } from 'clawblox-ts';

const client = new ClawBloxClient();
const [agentA, agentB] = await Promise.all([
  ClawBloxSession.create(client, { label: 'agent-a' }),
  ClawBloxSession.create(client, { label: 'agent-b' }),
]);
await agentA.sendMessage(agentB.sessionId, 'ping', { data: 42 });
```

---

## API Reference

| Group | Base Path | Description |
|---|---|---|
| Game | `/api/game/*` | Start/stop/execute/query the Lua VM |
| Sessions | `/api/session/*` | Isolated multi-agent session lifecycle |
| Observe | `/api/observe/*` | State snapshots, screenshots, GUI inspection |
| Simulation | `/api/simulation/*` | Deterministic mode, trajectory export/replay |
| Test | `/api/test/*` | run, run_batch, coverage |
| Debug | `/api/debug/*` | Breakpoints, step/continue, hot-reload, profiling |
| Agent | `/api/agent/*` | inject_lua, interrupt |
| Messaging | `/api/messaging/bridge` | Cross-session event delivery |
| Deploy | `/api/deploy` | Generate .rbxlx, push to Roblox Open Cloud |
| OpenAPI | `/api/openapi.json` | Full OpenAPI 3.1 spec |

→ Full spec: `GET /api/openapi.json`

For detailed endpoint documentation, see [`CLAWBLOX_USER_GUIDE.md`](CLAWBLOX_USER_GUIDE.md).

---

## System Requirements

| | Minimum |
|---|---|
| OS | Linux, Windows 10+, macOS 11+ |
| Node.js | 18+ |
| npm | 8+ |
| RAM | 4GB |
| Disk | ~500MB |
| Display | Required for Electron GUI only |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full history.

### v1.1.0 — 2026-03-12

Eight waves of new capabilities shipping in this release:

- **Wave A — Structured Observability**: `/api/observe/state`, `/api/observe/screenshot`, `/api/observe/gui-json`, typed WebSocket events
- **Wave B — Deterministic Simulation**: Seeded RNG, trajectory export (`export_trajectory`) and replay
- **Wave C — Multi-Agent Sessions**: Up to 64 isolated Lua VMs, full session lifecycle API, cross-session messaging bridge
- **Wave D — OpenAPI 3.1 + TypeScript SDK**: Complete spec for 75+ endpoints, `clawblox-ts` with `ClawBloxClient`, `ClawBloxSession`, `ClawBloxAgent`
- **Wave E — Python SDK**: `clawblox-py` with matching API, plus example scripts (basic_agent.py, multi_agent.py, random_walk.py)
- **Wave F — Test Framework v2**: `state_match`, `performance`, `reward_hook`, batch runner, coverage report, structured v2 output
- **Wave G — Docker + CLI + Headless Hardening**: Dockerfile, docker-compose, `clawblox` CLI, graceful shutdown, enhanced `/api/health`
- **Wave H — Advanced Debugging**: Breakpoints, step/continue, locals inspection, hot-reload, CPU profiling, `inject_lua`, `interrupt`, structured errors across all endpoints

---

## License

MIT — use it, fork it, build on it.
