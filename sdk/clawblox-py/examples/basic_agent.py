#!/usr/bin/env python3
"""Basic agent example - Simple PPO-style loop with random actions."""

import random

from clawblox import ClawBloxAgent


def main():
    """Run a simple agent loop."""
    # Initialize agent with deterministic mode
    agent = ClawBloxAgent(deterministic=True, seed=42)

    # Reset to get initial state
    state = agent.reset()
    print(f"Initial state: {len(state.instances)} instances")

    # Define a set of possible actions
    actions = [
        'game.Workspace.Part.Position = Vector3.new(0, 5, 0)',
        'game.Workspace.Part.Size = Vector3.new(4, 4, 4)',
        'game.Workspace.Part.Color = Color3.new(1, 0, 0)',
        'game.Workspace.Part.Transparency = 0.5',
        'game.Workspace.Part.Anchored = true',
    ]

    # Run the agent loop
    total_reward = 0.0
    for step in range(1000):
        # Choose random action
        action = random.choice(actions)

        # Execute step
        result = agent.step(action)

        # Track reward
        total_reward += result.reward
        state = result.state

        # Print progress every 100 steps
        if (step + 1) % 100 == 0:
            print(f"Step {step + 1}: reward={result.reward:.4f}, total={total_reward:.4f}, instances={len(state.instances)}")

        # Reset if done
        if result.done:
            print(f"Resetting at step {step + 1}")
            state = agent.reset()

    # Clean up
    agent.destroy()
    print(f"Done! Total reward: {total_reward:.4f}")


if __name__ == "__main__":
    main()
