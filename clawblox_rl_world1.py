#!/usr/bin/env python3
"""
ClawBlox RL Training Script for World 1 - v2
Physics fix applied - Anchored Parts are STATIC bodies
"""

import json
import gzip
import gc
import time
import psutil
import random
import re
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional

from clawblox import ClawBloxClient, ClawBloxAgent
from clawblox.exceptions import ClawBloxTimeout, ClawBloxConnectionError

# Configuration - UPDATED
SEED = 42
NUM_EPISODES = 50
MAX_STEPS = 150  # Updated from 50
SPAWN_X = 0
SPAWN_Y = 5  # Y=5 above platform at Y=0
SPAWN_Z = 0
STEP_DELAY = 0.03  # Reduced delay for speed

# Rewards - UPDATED
REWARD_GOAL = 10.0
REWARD_FORWARD = 1.0  # NEW: forward progress reward
REWARD_DEATH = -5.0   # Fall below Y=-2
REWARD_STEP = -0.1

GOAL_POSITION = {"X": 60, "Y": 5, "Z": 0}
GOAL_THRESHOLD = 15.0
DEATH_Y = -2  # NEW: death threshold


@dataclass
class TrajectoryStep:
    episode: int
    step: int
    action: str
    position: Dict[str, float]
    reward: float
    cumulative_reward: float
    done: bool


@dataclass
class EpisodeResult:
    episode: int
    total_reward: float
    steps: int
    goal_reached: bool
    final_position: Dict[str, float]
    trajectory: List[TrajectoryStep]
    min_y: float  # Track min Y to verify physics fix


class ClawBloxRLTrainer:
    def __init__(self, seed: int = 42):
        self.seed = seed
        random.seed(seed)
        
        self.client = ClawBloxClient("http://localhost:3001", timeout=10.0)
        print(f"API: {self.client.health().status}")
        
        self.agent = ClawBloxAgent(self.client, seed=seed, deterministic=True)
        self.agent.reset()
        
        self.episode_results: List[EpisodeResult] = []
        self.peak_ram = 0
        
    def spawn_world(self):
        """Spawn training world - with platform at Y=0 for physics fix"""
        lua = """
-- Clear workspace
for _, c in pairs(workspace:GetChildren()) do
    if c.Name ~= "Baseplate" and c.Name ~= "Camera" and c.Name ~= "Light" then
        c:Destroy()
    end
end

-- Platform at Y=0 (character spawns at Y=5 above it)
local platform = Instance.new("Part")
platform.Name = "Platform"
platform.Size = Vector3.new(80, 1, 10)
platform.Position = Vector3.new(30, 0, 0)
platform.Anchored = true
platform.BrickColor = BrickColor.new("Dark stone gray")
platform.Parent = workspace

-- Goal at X=60
local goal = Instance.new("Part")
goal.Name = "Goal"
goal.Size = Vector3.new(5, 5, 5)
goal.Position = Vector3.new(60, 5, 0)
goal.Anchored = true
goal.BrickColor = BrickColor.new("Bright yellow")
goal.Parent = workspace

-- Character spawns at Y=5 (above platform at Y=0)
local character = Instance.new("Part")
character.Name = "Character"
character.Size = Vector3.new(2, 4, 1)
character.Position = Vector3.new(0, 5, 0)
character.Anchored = false
character.BrickColor = BrickColor.new("Bright red")
character.Parent = workspace
"""
        self.agent.step(lua)
        print("World spawned with physics fix (platform at Y=0, spawn at Y=5)")
        
    def safe_step(self, lua_code: str, retries=3, delay=0.5):
        """Execute Lua with retry logic"""
        for i in range(retries):
            try:
                return self.agent.step(lua_code)
            except (ClawBloxTimeout, ClawBloxConnectionError) as e:
                if i < retries - 1:
                    time.sleep(delay)
                    continue
                raise
    
    def get_position(self) -> Optional[Dict[str, float]]:
        """Get character position from state"""
        try:
            result = self.safe_step("local _ = 1")
            if not result.state:
                return None
                
            for inst in result.state.instances:
                name = inst.get('Name', '')
                if name in ['Character', 'Part']:
                    props = inst.get('properties', {})
                    pos_str = props.get('Position', '')
                    if isinstance(pos_str, str) and 'Vector3' in pos_str:
                        match = re.search(r'Vector3\(([-\d.]+),([-\d.]+),([-\d.]+)\)', pos_str)
                        if match:
                            return {'X': float(match.group(1)), 'Y': float(match.group(2)), 'Z': float(match.group(3))}
        except Exception:
            pass
        return None
    
    def move(self, action: str):
        """Execute action using Velocity API - the primary movement method for RL agents"""
        moves = {
            # Velocity-based movement: preserve Y velocity (gravity), set X/Z
            "move_forward": "workspace.Character.Velocity = Vector3.new(workspace.Character.Velocity.X, workspace.Character.Velocity.Y, 10)\nRunService:Step(0.033)",
            "move_back": "workspace.Character.Velocity = Vector3.new(workspace.Character.Velocity.X, workspace.Character.Velocity.Y, -10)\nRunService:Step(0.033)",
            # Jump: apply upward velocity impulse only if near ground (Y < 2)
            "jump": """
local pos = workspace.Character.Position
if pos.Y < 2 then
    workspace.Character.Velocity = Vector3.new(workspace.Character.Velocity.X, 15, workspace.Character.Velocity.Z)
end
RunService:Step(0.033)
""",
            # Attack: no movement (reward-only action)
            "attack": "workspace.Character.Velocity = Vector3.new(workspace.Character.Velocity.X, workspace.Character.Velocity.Y, workspace.Character.Velocity.Z)",
        }
        self.safe_step(moves.get(action, moves["move_forward"]))
        
    def reset_agent(self):
        """Reset to spawn at Y=5"""
        self.safe_step(f"workspace.Character.Position = Vector3.new({SPAWN_X}, {SPAWN_Y}, {SPAWN_Z})")
        
    def dist_to_goal(self, pos: Dict) -> float:
        if not pos:
            return 9999
        dx = pos.get("X", 0) - GOAL_POSITION["X"]
        dy = pos.get("Y", 0) - GOAL_POSITION["Y"]
        dz = pos.get("Z", 0) - GOAL_POSITION["Z"]
        return (dx*dx + dy*dy + dz*dz) ** 0.5
    
    def compute_reward(self, pos: Dict, prev_x: float, done: bool) -> tuple:
        """Compute reward with forward progress bonus"""
        r = REWARD_STEP
        
        # Check death (fall below Y=-2)
        if pos and pos.get("Y", 0) < DEATH_Y:
            r += REWARD_DEATH
            done = True
            
        # Forward progress reward
        if pos and prev_x is not None:
            dx = pos.get("X", 0) - prev_x
            if dx > 0:
                r += REWARD_FORWARD
                
        # Check goal
        if pos and self.dist_to_goal(pos) < GOAL_THRESHOLD:
            r += REWARD_GOAL
            done = True
            
        return r, done
    
    def run_episode(self, ep: int) -> Optional[EpisodeResult]:
        """Run a single episode - returns None on error but saves progress"""
        try:
            self.reset_agent()
            time.sleep(STEP_DELAY * 2)
            
            traj = []
            total_r = 0.0
            done = False
            goal = False
            pos = {"X": SPAWN_X, "Y": SPAWN_Y, "Z": SPAWN_Z}
            min_y = SPAWN_Y
            prev_x = SPAWN_X
            
            # Get initial position
            p = self.get_position()
            if p:
                pos = p
                min_y = min(min_y, p.get("Y", SPAWN_Y))
                prev_x = p.get("X", SPAWN_X)
                
            for step in range(MAX_STEPS):
                # Action selection - mix of random and goal-directed
                if random.random() < 0.2:  # 20% random exploration
                    act = random.choice(["move_forward", "move_back", "jump", "attack"])
                else:
                    # Go toward goal if behind it, otherwise random
                    if pos.get("X", 0) < GOAL_POSITION["X"]:
                        act = "move_forward"
                    elif pos.get("X", 0) > GOAL_POSITION["X"] + 5:
                        act = "move_back"
                    else:
                        act = random.choice(["move_forward", "jump"])
                
                self.move(act)
                time.sleep(STEP_DELAY)
                
                # Get new position
                p = self.get_position()
                if p:
                    pos = p
                    min_y = min(min_y, p.get("Y", SPAWN_Y))
                
                # Compute reward with forward progress
                r, done = self.compute_reward(pos, prev_x, done)
                prev_x = pos.get("X", prev_x)
                total_r += r
                
                # Check goal
                if self.dist_to_goal(pos) < GOAL_THRESHOLD:
                    goal = done = True
                    total_r += REWARD_GOAL
                    
                # Record trajectory (every step for detailed export)
                traj.append(TrajectoryStep(ep, step, act, pos, r, total_r, done))
                
                if done:
                    break
                    
            return EpisodeResult(ep, total_r, step+1, goal, pos, traj, min_y)
            
        except Exception as e:
            print(f"  Warning: Episode {ep} failed: {e}")
            return None
    
    def train(self):
        print("=" * 50)
        print("ClawBlox RL Training - World 1 v2")
        print("Physics Fix: Anchored Parts = STATIC bodies")
        print("=" * 50)
        
        self.spawn_world()
        time.sleep(0.2)
        
        process = psutil.Process()
        
        for ep in range(NUM_EPISODES):
            result = self.run_episode(ep)
            
            if result:
                self.episode_results.append(result)
                
                # Track peak RAM
                mem = process.memory_info().rss / 1024 / 1024
                self.peak_ram = max(self.peak_ram, mem)
                
                # Print progress
                print(f"Ep {ep+1:2d}: steps={result.steps:3d}, reward={result.total_reward:6.1f}, "
                      f"goal={result.goal_reached}, min_Y={result.min_y:.1f}")
                
                # Early physics check (first 5 episodes)
                if ep < 5:
                    if result.min_y >= 0:
                        print(f"  ✓ Physics fix working: Y stayed >= 0 (min={result.min_y})")
                    else:
                        print(f"  ✗ WARNING: Y dropped to {result.min_y} - physics may have issue")
                
                # Save checkpoint every 10 episodes
                if ep > 0 and ep % 10 == 0:
                    self.export(f"world1_checkpoint_ep{ep}.jsonl.gz")
                    gc.collect()
            else:
                # Episode failed - try to continue
                print(f"Ep {ep+1:2d}: FAILED (skipping)")
                time.sleep(1)  # Wait before retrying
        
        return self.episode_results
    
    def export(self, path: str = "world1_trajectories_v2.jsonl.gz"):
        with gzip.open(path, 'wt') as f:
            for r in self.episode_results:
                for s in r.trajectory:
                    f.write(json.dumps(asdict(s)) + "\n")
        print(f"Exported to {path}")
        return path
    
    def summary(self):
        print("\n" + "=" * 50)
        print("SUMMARY REPORT")
        print("=" * 50)
        
        if not self.episode_results:
            print("No episodes completed!")
            return
        
        rewards = [r.total_reward for r in self.episode_results]
        goals = sum(1 for r in self.episode_results if r.goal_reached)
        
        # Episode reward curve (last 10 episodes)
        print("\n--- Episode Reward Curve (last 10) ---")
        recent = self.episode_results[-10:]
        for r in recent:
            bar = "█" * int(max(0, r.total_reward + 10) / 2)
            print(f"Ep {r.episode+1:2d}: {r.total_reward:6.1f} {bar}")
        
        print("\n--- Statistics ---")
        print(f"Total episodes completed: {len(self.episode_results)}/{NUM_EPISODES}")
        print(f"Mean reward: {sum(rewards)/len(rewards):.2f}")
        print(f"Best episode: #{max(self.episode_results, key=lambda r: r.total_reward).episode+1}")
        print(f"Best reward: {max(rewards):.2f}")
        print(f"Goal reach rate: {goals}/{len(self.episode_results)} ({100*goals/len(self.episode_results):.1f}%)")
        
        # Physics fix verification
        if self.episode_results:
            early_eps = self.episode_results[:min(5, len(self.episode_results))]
            physics_ok = all(r.min_y >= 0 for r in early_eps)
            print(f"\n--- Physics Fix Verification ---")
            print(f"Early episodes min Y values: {[round(r.min_y,1) for r in early_eps]}")
            print(f"Physics fix working: {'✓ YES' if physics_ok else '✗ NO'}")
        
        print(f"\nPeak RAM: {self.peak_ram:.1f} MB")


def main():
    process = psutil.Process()
    mem_start = process.memory_info().rss / 1024 / 1024
    print(f"Starting RAM: {mem_start:.1f} MB")
    print(f"Config: {NUM_EPISODES} episodes, {MAX_STEPS} steps each")
    print()
    
    try:
        trainer = ClawBloxRLTrainer(SEED)
        results = trainer.train()
        
        trainer.summary()
        trainer.export("world1_trajectories_v2.jsonl.gz")
        
        print("\n" + "=" * 50)
        print("TRAINING COMPLETE")
        print("=" * 50)
    except KeyboardInterrupt:
        print("\nInterrupted - saving partial results...")
        if 'trainer' in locals() and trainer.episode_results:
            trainer.summary()
            trainer.export("world1_trajectories_partial.jsonl.gz")


if __name__ == "__main__":
    main()
