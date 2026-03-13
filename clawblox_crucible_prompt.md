# ClawBlox v1.1.0 Full-Capabilities Test Prompt — Corrected for Actual API Surface

**System:** Linux laptop | AMD Ryzen AI 7 350 (8 cores / 16 threads) | 9 GB free RAM | Radeon 860M iGPU | No Docker | ClawBlox API on port 3001 | Python 3.14.3 | psutil 7.2.2 installed

---

You are an elite autonomous-agent engineer specializing in reinforcement-learning environments and headless game simulators.

The user has ClawBlox Studio v1.1.0 running locally with the Python SDK installed. Your single job is to create the ultimate verification test that exercises every agent-native feature in v1.1.0 without exceeding ~7 GB RAM peak.

**Scenario:** Build and train a simple "Obby" (obstacle course) agent. 5 platforms in a straight line. The agent must learn to jump from platform 1 → 5 to touch a glowing GoalPart. Use deterministic mode and full observability.

---

## EXACT API SURFACE (do not deviate — these are the real class/method names)

### Import
```python
from clawblox import ClawBloxClient, ClawBloxSession, ClawBloxAgent, AgentStepResult
import psutil  # installed: 7.2.2
```

### ClawBloxClient methods (use `client = ClawBloxClient("http://localhost:3001")`)
- `client.health()` → HealthResponse
- `client.session_create(seed=42, deterministic=True)` → SessionCreateResponse (has `.session_id`)
- `client.session_list()` → list[SessionSummary]
- `client.session_destroy(session_id)` → dict
- `client.session_execute(session_id, code: str)` → SessionExecuteResponse
- `client.session_state(session_id)` → SessionStateResponse
- `client.session_reset(session_id)` → SessionResetResponse
- `client.session_messages(session_id)` → list[dict]
- `client.observe_state()` → ObserveState (global game state, not per-session)
- `client.observe_screenshot()` → ScreenshotResponse (⚠ headless: returns note, not image — handle gracefully)
- `client.observe_gui_json()` → GuiJsonResponse
- `client.simulation_export_trajectory()` → list[TrajectoryFrame]
- `client.test_run(code=<lua_str>)` → TestRunV2Response
- `client.test_run_batch(tests=[...])` → batch results
- `client.debug_set_breakpoint(line, file)` → dict (has breakpoint id)
- `client.debug_breakpoints()` → dict
- `client.messaging_bridge(from_session, to_session, event, data)` → BridgeMessageResponse

### ClawBloxAgent (high-level RL interface, wraps a session)
```python
agent = ClawBloxAgent(client, seed=42, deterministic=True)
```
- `agent.reset()` → ObserveState
- `agent.step(lua_action: str)` → AgentStepResult
- `agent.observe()` → ObserveState  # no args
- `agent.run_test(test_code: str)` → dict
- `agent.export_trajectory()` → list[dict]
- `agent.destroy()` → None
- Supports context manager: `with ClawBloxAgent(client) as agent:`

### reward_hook — Lua-side only
`reward_hook` is a Lua function available inside `.clawtest.lua` test scripts (passed to `client.test_run()`). It registers a Lua callback that fires during test execution. To use reward shaping in Python, compute rewards directly in Python from `AgentStepResult` data returned by `agent.step()`. Do NOT call `reward_hook` from Python.

### state_match / expect.performance — Lua-side only
These are Lua test matchers inside `.clawtest.lua` scripts, used via `client.test_run(code=<lua>)`. They are NOT Python methods. To demonstrate them, embed them in a Lua test string passed to `test_run()`.

### Screenshot in headless mode
`client.observe_screenshot()` returns a response with a `note` field instead of image data when running headlessly (no Electron GUI). The script must check for this and skip screenshot saving gracefully rather than crashing.

---

## OUTPUT STRUCTURE (exactly these 5 sections, no extra fluff)

### A. Quick Setup & Verification Commands (Linux)
Exact terminal commands to confirm: API alive on 3001, SDK importable, psutil available, free RAM check.

### B. Complete Python Test Script
**File name:** `clawblox_full_test_obby_agent.py`

The script MUST:
- Import `ClawBloxClient`, `ClawBloxSession`, `ClawBloxAgent` (NOT `ClawBloxEnv` — it does not exist)
- Create exactly **3 ClawBloxAgent instances** (safe for 9 GB RAM), each with `seed=42, deterministic=True`
- Spawn the Obby scene in each session via `agent.step()` with Lua code that creates: Baseplate + 5 platform Parts + GoalPart + a simple Character part
- Run a **10-epoch training loop** (200 steps per epoch) per agent
- Every 10 steps: call `agent.observe()` (no args) + `client.observe_state()` and log to disk
- Attempt `client.observe_screenshot()` once and handle headless gracefully (print note, skip saving)
- Demonstrate **Lua-side reward_hook and state_match** by passing a `.clawtest.lua` string to `agent.run_test()`:
  ```lua
  reward_hook(function(state) return 1.0 end)
  describe("Obby", function()
    it("state_match passes", function()
      expect.state_match({tick=0}, {ignore_keys={"seed"}})
    end)
  end)
  ```
- Compute **Python-side rewards** from `AgentStepResult` fields (distance/score delta)
- Demonstrate **cross-session messaging**: `client.messaging_bridge(session_a, session_b, "sync", {epoch=n})`
- Demonstrate **breakpoint + inject**: set a breakpoint via `client.debug_set_breakpoint()`, then inject Lua via `client.session_execute(session_id, "-- injected jump code")` to simulate mid-training intervention
- Call `agent.export_trajectory()` on all 3 agents at the end; write each to `trajectory_N.json` (gzip if possible with Python's built-in `gzip` module)
- Use `client.test_run_batch()` to run 3 parallel test snippets demonstrating batch execution
- Monitor RAM throughout with `psutil.virtual_memory()` and print peak usage at the end
- Include aggressive `gc.collect()` calls between epochs
- Print final **"ALL v1.1.0 FEATURES VERIFIED"** summary
- Stay under 400 lines, well-commented

### C. Step-by-Step Execution Instructions
Exact commands: how to run the script, monitor RAM live with `free -h` or `watch free -h`, view trajectory files, clean up sessions.

### D. Success Verification Checklist
10+ bullets of what the user should see if the test passes (e.g. "3 deterministic trajectories exported", "reward_hook triggered inside Lua test", "state_match passed in Lua test output", "headless screenshot handled gracefully", "peak RAM stayed under 7 GB", "cross-session bridge message sent", "breakpoint set and returned id", etc.)

### E. Next-Level Scaling Test
One paragraph: how to scale to 8–12 sessions on this same machine. Include a quick Docker install command for Arch Linux (`yay -S docker` or `pacman -S docker`) + a minimal `docker-compose.yml` snippet for spinning up multiple headless ClawBlox API instances behind a simple round-robin script.

---

## Rules
- Only use features/methods listed in the API surface above
- No `ClawBloxEnv`, no Python-side `reward_hook`, no Python-side `state_match`
- Screenshot failure must be handled gracefully (try/except or check response)
- All local/offline, memory-safe for 9 GB free RAM
- psutil is available for RAM monitoring
- Prioritize correctness over cleverness — this script will be run for real
