#!/usr/bin/env python3
"""Random walk agent - Good baseline for testing."""

import random
import time

from clawblox import ClawBloxAgent


def generate_random_action() -> str:
    """Generate a random Lua action.

    Returns:
        Random Lua code string
    """
    # Generate random values
    x = random.uniform(-10, 10)
    y = random.uniform(0, 10)
    z = random.uniform(-10, 10)
    r = random.uniform(0, 1)
    g = random.uniform(0, 1)
    b = random.uniform(0, 1)

    # Pick a random action type
    action_type = random.choice([
        "position",
        "size",
        "color",
        "rotation",
        "anchored",
        "transparency",
    ])

    if action_type == "position":
        return f"game.Workspace.Part.Position = Vector3.new({x:.2f}, {y:.2f}, {z:.2f})"
    elif action_type == "size":
        return f"game.Workspace.Part.Size = Vector3.new({random.uniform(1, 5):.2f}, {random.uniform(1, 5):.2f}, {random.uniform(1, 5):.2f})"
    elif action_type == "color":
        return f"game.Workspace.Part.Color = Color3.new({r:.2f}, {g:.2f}, {b:.2f})"
    elif action_type == "rotation":
        return f"game.Workspace.Part.Rotation = Vector3.new({random.uniform(0, 360):.2f}, {random.uniform(0, 360):.2f}, {random.uniform(0, 360):.2f})"
    elif action_type == "anchored":
        return f"game.Workspace.Part.Anchored = {random.choice([True, False])}"
    else:  # transparency
        return f"game.Workspace.Part.Transparency = {random.uniform(0, 1):.2f}"


def main():
    """Run random walk agent."""
    print("Starting Random Walk Agent...")

    # Create agent
    agent = ClawBloxAgent(deterministic=False, seed=None)

    # Statistics
    total_steps = 0
    total_reward = 0.0
    episodes = 0

    # Run for a fixed number of episodes
    for episode in range(10):
        print(f"\n=== Episode {episode + 1} ===")

        # Reset agent
        state = agent.reset()
        episode_reward = 0.0
        episode_steps = 0

        print(f"Initial state: {len(state.instances)} instances")

        # Run episode
        while episode_steps < 100:
            # Generate random action
            action = generate_random_action()

            # Execute step
            result = agent.step(action)

            # Track statistics
            episode_reward += result.reward
            episode_steps += 1
            total_steps += 1

            # Print every 20 steps
            if episode_steps % 20 == 0:
                print(f"  Step {episode_steps}: reward={result.reward:.4f}, instances={len(result.state.instances)}")

            # Check if done
            if result.done:
                print(f"  Done at step {episode_steps}!")
                break

        # Episode summary
        total_reward += episode_reward
        episodes += 1
        print(f"Episode {episode + 1} complete: steps={episode_steps}, reward={episode_reward:.4f}")

    # Final summary
    print("\n" + "=" * 40)
    print("Random Walk Agent Complete")
    print("=" * 40)
    print(f"Total episodes: {episodes}")
    print(f"Total steps: {total_steps}")
    print(f"Total reward: {total_reward:.4f}")
    print(f"Average reward per step: {total_reward / total_steps:.4f}")

    # Clean up
    agent.destroy()


if __name__ == "__main__":
    main()
