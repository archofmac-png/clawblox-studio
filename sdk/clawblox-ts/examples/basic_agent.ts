// Basic PPO-style agent loop example
import { ClawBloxAgent, ClawBloxClient, ObserveStateResponse } from '../src';

// Simple policy function - replace with your own
function policy(state: ObserveStateResponse): string {
  // Example: move forward
  return `game:GetService("Players").LocalPlayer.Character:MoveTo(Vector3.new(0, 0, -5))`;
}

async function main() {
  const agent = new ClawBloxAgent();
  
  // Get initial state
  let state = await agent.reset();
  
  console.log('Agent started with seed:', agent['seed']);
  
  for (let step = 0; step < 1000; step++) {
    // Get action from policy
    const action = policy(state);
    
    // Execute step
    const { state: nextState, done } = await agent.step(action);
    
    state = nextState;
    
    if (done) {
      console.log(`Episode done at step ${step}, resetting...`);
      state = await agent.reset();
    }
    
    if (step % 100 === 0) {
      console.log(`Step ${step}: tick = ${state.metadata?.tick}`);
    }
  }
  
  await agent.destroy();
  console.log('Agent destroyed');
}

main().catch(console.error);
