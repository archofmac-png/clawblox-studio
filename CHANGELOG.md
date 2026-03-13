# Changelog

All notable changes to ClawBlox Studio are documented here.

## [1.1.0] — 2026-03-12

### Added

#### Wave A — Structured Observability
- `GET /api/observe/state` — typed state snapshot (instances, metadata, physics)
- `GET /api/observe/screenshot` — base64 PNG of current viewport
- `GET /api/observe/gui-json` — GUI element tree as JSON
- Typed WebSocket events: `instance_created`, `instance_changed`, `physics_tick`, `console:structured`

#### Wave B — Deterministic Simulation
- Seeded RNG mode for reproducible Lua execution
- `POST /api/simulation/export_trajectory` — JSONL frame-by-frame trajectory export
- `POST /api/simulation/replay` — replay a trajectory

#### Wave C — Multi-Agent Session Orchestration
- Up to 64 isolated concurrent Lua VMs via session manager
- `POST /api/session/create` with label, deterministic mode, seed
- Full session lifecycle: execute, state, reset, start, stop, destroy
- `GET /api/session/:id/messages` — per-session message history
- `POST /api/messaging/bridge` — cross-session event delivery
- Per-session WebSocket subscriptions

#### Wave D — OpenAPI 3.1 + TypeScript SDK
- `openapi.json` — complete spec for all 75+ endpoints
- `GET /api/openapi.json` and `GET /api/openapi.yaml`
- `sdk/clawblox-ts/` — TypeScript SDK with ClawBloxClient, ClawBloxSession, ClawBloxAgent

#### Wave E — Python SDK
- `sdk/clawblox-py/` — Python SDK with ClawBloxClient, ClawBloxSession, ClawBloxAgent
- Examples: basic_agent.py, multi_agent.py, random_walk.py

#### Wave F — Test Framework v2
- `expect.state_match(snapshot, options?)` — deep state comparison with numeric tolerance
- `expect.performance(options, callback)` — execution time assertion
- `reward_hook(callback)` — RL reward shaping in tests
- `POST /api/test/run_batch` — sequential or parallel batch runner with isolated sessions
- `GET /api/test/coverage` — Lua/Luau file coverage report
- Structured v2 test output: skipped count, rewards_total, trajectory_frames

#### Wave G — Docker + CLI + Headless Hardening
- `Dockerfile` + `.dockerignore` + `docker-compose.yml`
- `clawblox` CLI: run, execute, test, session, status subcommands
- Startup banner in headless mode
- Graceful SIGTERM/SIGINT shutdown (destroys sessions → closes WS → closes HTTP)
- Enhanced `/api/health` with version, uptime, session counts, mode

#### Wave H — Advanced Debugging
- `POST /api/debug/breakpoint/set` — set conditional breakpoints
- `GET /api/debug/breakpoints` — list all breakpoints with hit counts
- `DELETE /api/debug/breakpoint/:id`
- `POST /api/debug/step` — step one line forward when paused
- `POST /api/debug/continue` — resume from breakpoint
- `GET /api/debug/locals` — inspect locals and upvalues while paused
- `POST /api/debug/hot-reload` — patch live scripts without VM restart
- `POST /api/debug/profile/start` + `stop` — CPU profiling with per-function timings
- `POST /api/agent/inject_lua` — inject code into live session without state reset
- `POST /api/agent/interrupt` — force-kill and reinitialize Lua VM
- Structured error format across all endpoints: error_type, traceback, context_snapshot
- SDK methods for all debug endpoints (clawblox-ts + clawblox-py)

---

## [1.0.0] — 2026-03-11

### Added
- Initial release
- Monaco code editor with Luau syntax highlighting
- Babylon.js 3D viewport
- wasmoon Lua 5.4 VM with Roblox service shims
- Jest-like test framework (describe/it/expect)
- Deploy pipeline (generate .rbxlx, push to Roblox Open Cloud)
- HTTP REST API (75+ endpoints) + WebSocket server
- isomorphic-git integration
- Electron desktop application
