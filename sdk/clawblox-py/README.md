# clawblox-py

Python SDK for ClawBlox Studio - A Roblox game engine API client.

## Installation

```bash
pip install clawblox-py
```

## Quick Start

```python
from clawblox import ClawBloxClient, ClawBloxSession, ClawBloxAgent

# Create a client
client = ClawBloxClient(base_url="http://localhost:3001")

# Use sessions for isolated execution contexts
session = ClawBloxSession.create(client, label="my-agent")

# Execute Lua code
result = session.execute('print("Hello from Lua!")')
print(result)

# Or use the RL-style Agent interface
agent = ClawBloxAgent(client, deterministic=True, seed=42)
state = agent.reset()

for step in range(100):
    result = agent.step('game.Workspace.Part.Position = Vector3.new(0, 5, 0)')
    if result.done:
        state = agent.reset()

agent.destroy()
```

## API Overview

### ClawBloxClient

Main client class for interacting with the ClawBlox Studio API.

- `game_start(deterministic, seed)` - Start the game
- `game_stop()` - Stop the game
- `game_execute(code, deterministic, seed)` - Execute Lua code
- `game_instances()` - Get all instances
- `game_state_snapshot()` - Get game state snapshot
- `session_create(label, deterministic, seed)` - Create a session
- `session_list()` - List all sessions
- `session_destroy(session_id)` - Destroy a session
- `session_execute(session_id, code)` - Execute in session
- `session_state(session_id)` - Get session state
- `session_reset(session_id)` - Reset session
- `session_messages(session_id)` - Get session messages
- `observe_state()` - Get current state
- `observe_screenshot()` - Get screenshot
- `observe_gui_json()` - Get GUI elements
- `simulation_export_trajectory()` - Export trajectory
- `simulation_replay(frames)` - Replay trajectory
- `messaging_bridge(from_session, to_session, event, data)` - Send message between sessions
- `ws_connect(session_id)` - Connect to WebSocket

### ClawBloxSession

Wrapper for an isolated session context.

- `execute(code)` - Execute Lua code
- `observe()` - Get session state
- `reset()` - Reset session
- `destroy()` - Destroy session
- `send_message(to_session, event, data)` - Send message to another session

### ClawBloxAgent

Reinforcement learning-style interface for agents.

- `reset()` - Create fresh session, get initial state
- `step(lua_action)` - Execute action, return state + reward + done
- `observe()` - Get current state
- `destroy()` - Clean up session

## Examples

See the `examples/` directory for more examples:

- `basic_agent.py` - Simple PPO loop
- `multi_agent.py` - Multi-agent messaging
- `random_walk.py` - Random action baseline

## WebSocket Events

The SDK supports WebSocket connections for real-time events:

```python
with client.ws_connect(session_id) as ws:
    for event in ws:
        print(event)  # instance_created, instance_changed, physics_tick, etc.
```

## License

MIT
