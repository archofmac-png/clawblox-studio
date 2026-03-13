# clawblox-ts

TypeScript SDK for ClawBlox Studio API - The Roblox development environment rebuilt for AI agents.

## Installation

```bash
npm install clawblox-ts
```

## Quick Start

```typescript
import { ClawBloxClient, ClawBloxAgent, ClawBloxSession } from 'clawblox-ts';

// Low-level client
const client = new ClawBloxClient({ baseUrl: 'http://localhost:3001' });
const health = await client.health();
console.log('Server status:', health.status);

// Agent loop (PPO-style)
const agent = new ClawBloxAgent();
let state = await agent.reset();
for (let step = 0; step < 1000; step++) {
  const action = yourPolicy(state);
  const { state: next, done } = await agent.step(action);
  state = next;
  if (done) state = await agent.reset();
}
await agent.destroy();
```

## API Reference

### ClawBloxClient

Low-level REST client with auto-retry on 429/503:

```typescript
const client = new ClawBloxClient({ baseUrl: 'http://localhost:3001', timeout: 30000 });

// Game control
await client.gameStart({ deterministic: true, seed: 12345 });
await client.gameExecute('print("Hello!")');
await client.gameStop();

// Session management
const session = await client.sessionCreate({ label: 'my-agent' });
await client.sessionExecute(session.session_id, 'return 42');
```

### ClawBloxSession

Session wrapper for multi-agent workflows:

```typescript
const session = await ClawBloxSession.create(client, { label: 'agent-1' });
await session.execute('print("Hello")');
const state = await session.observe();
await session.reset();
await session.sendMessage(otherSessionId, 'event', { data: 42 });
await session.destroy();
```

### ClawBloxAgent

High-level RL-style agent interface:

```typescript
const agent = new ClawBloxAgent(client, { deterministic: true });
const state = await agent.reset();       // Create session, get initial state
const { state, done } = await agent.step('move forward');
const trajectory = await agent.exportTrajectory();
await agent.destroy();
```

## Examples

See the `examples/` directory for more:

- `basic_agent.ts` - Simple PPO-style loop
- `multi_agent.ts` - Multi-agent messaging

## OpenAPI Spec

The full API specification is available at `openapi.json` in the repo root.
