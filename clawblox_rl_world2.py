#!/usr/bin/env python3
"""
ClawBlox RL Training Script for World 2
Vertical climbing challenge - reach the top platform
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
from clawblox.exceptions import ClawBloxTimeout

# Retry helper with longer timeouts and more retries
def with_retry(fn, max_retries=5, delay=2.0):
    last_err = None
    for i in range(max_retries):
        try:
            return fn()
        except (ClawBloxTimeout, Exception) as e:
            last_err = e
            if i < max_retries - 1:
                print(f"  Retry {i+1}/{max_retries} after timeout...")
                time.sleep(delay * (i + 1))
            else:
                print(f"  All retries failed: {last_err}")
                raise last_err

# Configuration
SEED = 42
NUM_EPISODES = 50  # Keep at 50 as requested
MAX_STEPS = 150    # Keep at 150 as requested
OBSERVE_EVERY = 5

# Rewards
REWARD_GOAL = 10.0
REWARD_UPWARD = 1.0  # Reward for increasing Y (upward progress)
REWARD_DEATH = -5.0  # Fall below Y=-2
REWARD_STEP = -0.1

# World 2 Layout: Vertical climbing challenge
# Goal at top platform (inst_47 at Y=15.5, Z=60)
GOAL_POSITION = {"X": 0, "Y": 20, "Z": 60}
GOAL_THRESHOLD = 5.0  # Distance to consider goal reached
SPAWN_POSITION = {"X": 0, "Y": 2, "Z": 60}  # Start above ground (Y=0.25 + char half-height)


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


class ClawBloxRLTrainer:
    def __init__(self, seed: int = 42, max_retries=5):
        self.seed = seed
        random.seed(seed)
        
        # Retry connection
        for i in range(max_retries):
            try:
                self.client = ClawBloxClient("http://localhost:3001", timeout=30.0)
                status = self.client.health()
                print(f"API: {status.status}")
                break
            except Exception as e:
                if i < max_retries - 1:
                    print(f"Connection retry {i+1}/{max_retries}...")
                    time.sleep(2)
                else:
                    raise
        
        self.agent = ClawBloxAgent(self.client, seed=seed, deterministic=True)
        self.agent.reset()
        self.spawn_world()
        
        self.episode_results: List[EpisodeResult] = []
        self.last_y = SPAWN_POSITION["Y"]  # Track for upward progress reward
        
    def spawn_world(self):
        """Spawn World 2 training world - vertical climbing challenge"""
        lua = """
-- Clear workspace except base
for _, c in pairs(workspace:GetChildren()) do
    if c.Name ~= "Baseplate" and c.Name ~= "Camera" and c.Name ~= "Light" then
        c:Destroy()
    end
end

-- Ground plane
local ground = Instance.new("Part")
ground.Name = "Ground"
ground.Size = Vector3.new(30, 0.5, 30)
ground.Position = Vector3.new(0, 0.25, 60)
ground.Anchored = true
ground.BrickColor = BrickColor.new("Dark stone gray")
ground.Parent = workspace

-- Platform 1 - Y=4, offset X=-5 (staircase left)
local p1 = Instance.new("Part")
p1.Name = "Platform1"
p1.Size = Vector3.new(8, 0.5, 8)
p1.Position = Vector3.new(-5, 4, 60)
p1.Anchored = true
p1.BrickColor = BrickColor.new("Stone gray")
p1.Parent = workspace

-- Platform 2 - Y=8, offset X=5 (staircase right)
local p2 = Instance.new("Part")
p2.Name = "Platform2"
p2.Size = Vector3.new(8, 0.5, 8)
p2.Position = Vector3.new(5, 8, 60)
p2.Anchored = true
p2.BrickColor = BrickColor.new("Dark green")
p2.Parent = workspace

-- Platform 3 - Y=12, offset X=-5 (staircase left)
local p3 = Instance.new("Part")
p3.Name = "Platform3"
p3.Size = Vector3.new(8, 0.5, 8)
p3.Position = Vector3.new(-5, 12, 60)
p3.Anchored = true
p3.BrickColor = BrickColor.new("Cyan")
p3.Parent = workspace

-- Platform 4 - Y=16, center
local p4 = Instance.new("Part")
p4.Name = "Platform4"
p4.Size = Vector3.new(8, 0.5, 8)
p4.Position = Vector3.new(0, 16, 60)
p4.Anchored = true
p4.BrickColor = BrickColor.new("Magenta")
p4.Parent = workspace

-- Goal Platform - Y=20
local goal = Instance.new("Part")
goal.Name = "GoalPlatform"
goal.Size = Vector3.new(12, 1, 12)
goal.Position = Vector3.new(0, 20, 60)
goal.Anchored = true
goal.BrickColor = BrickColor.new("Bright yellow")
goal.Parent = workspace

-- Goal Part (visual)
local goalPart = Instance.new("Part")
goalPart.Name = "Goal"
goalPart.Size = Vector3.new(3, 3, 3)
goalPart.Position = Vector3.new(0, 22, 60)
goalPart.Anchored = true
goalPart.BrickColor = BrickColor.new("Bright red")
goalPart.Parent = workspace

-- Character
local char = Instance.new("Part")
char.Name = "Character"
char.Size = Vector3.new(2, 4, 1)
char.Position = Vector3.new(0, 2, 60)
char.Anchored = false
char.Parent = workspace
"""
        def _spawn():
            return self.agent.step(lua)
        with_retry(_spawn)
        print("World 2 spawned: Vertical climbing challenge")
        
    def get_position(self) -> Optional[Dict[str, float]]:
        """Get character position from state with retry"""
        def _step():
            return self.agent.step("local _ = 1")
        
        try:
            result = with_retry(_step)
        except:
            return None
            
        if not result or not result.state:
            return None
            
        for inst in result.state.instances:
            name = inst.get('Name', '')
            if name in ['Character', 'Part']:
                props = inst.get('properties', {})
                pos = props.get('Position')
                # Position can be a dict {'X': ..., 'Y': ..., 'Z': ...} or a string
                if isinstance(pos, dict):
                    return {'X': float(pos.get('X', 0)), 'Y': float(pos.get('Y', 0)), 'Z': float(pos.get('Z', 0))}
                elif isinstance(pos, str) and 'Vector3' in pos:
                    match = re.search(r'Vector3\(([-\d.]+),([-\d.]+),([-\d.]+)\)', pos)
                    if match:
                        return {'X': float(match.group(1)), 'Y': float(match.group(2)), 'Z': float(match.group(3))}
        return None
    
    def move(self, action: str):
        """Execute action with retry and session recovery - using Velocity API"""
        # Velocity-based movement - preserve Y velocity (gravity), set X/Z
        # Same approach as World 1 which was confirmed working
        moves = {
            # forward/back move along Z axis - but goal is also at Z=60 so mostly vertical
            # Preserve Y velocity for gravity!
            "forward": "workspace.Character.AssemblyLinearVelocity = Vector3.new(workspace.Character.AssemblyLinearVelocity.X, workspace.Character.AssemblyLinearVelocity.Y, -10)",
            "back": "workspace.Character.AssemblyLinearVelocity = Vector3.new(workspace.Character.AssemblyLinearVelocity.X, workspace.Character.AssemblyLinearVelocity.Y, 10)",
            # Jump: ApplyImpulse (Roblox-style, mass-aware) — does not overwrite Y velocity
            "jump": "workspace.Character:ApplyImpulse(Vector3.new(0, 520, 0))",
            # Lateral movement: AssemblyLinearVelocity preserves Y (Roblox API)
            "left": "workspace.Character.AssemblyLinearVelocity = Vector3.new(-10, workspace.Character.AssemblyLinearVelocity.Y, workspace.Character.AssemblyLinearVelocity.Z)",
            "right": "workspace.Character.AssemblyLinearVelocity = Vector3.new(10, workspace.Character.AssemblyLinearVelocity.Y, workspace.Character.AssemblyLinearVelocity.Z)",
        }
        def _step():
            result = self.agent.step(moves.get(action, moves["forward"]))
            # Step physics after each action
            self.agent.session.physics_step(0.033)
            return result
        try:
            with_retry(_step)
        except Exception as e:
            if "Session not found" in str(e) or "404" in str(e):
                # Try to recover session
                print("  Session lost, reinitializing...")
                self.agent = ClawBloxAgent(self.client, seed=self.seed, deterministic=True)
                self.agent.reset()
                self.spawn_world()
                with_retry(_step)
        
    def reset_agent(self):
        """Reset to spawn using reset_part (preserves velocity properly)"""
        # Find the Character instance
        try:
            result = self.agent.step("return workspace.Character")
            if result and result.state:
                for inst in result.state.instances:
                    if inst.get('Name') == 'Character':
                        instance_id = inst.get('instance_id')
                        if instance_id:
                            self.agent.session.reset_part(instance_id, 0, 4, 60)
                            break
        except:
            pass  # Best effort
        self.last_y = SPAWN_POSITION["Y"]
        
    def dist_to_goal(self, pos: Dict) -> float:
        if not pos:
            return 9999
        dx = pos.get("X", 0) - GOAL_POSITION["X"]
        dy = pos.get("Y", 0) - GOAL_POSITION["Y"]
        dz = pos.get("Z", 0) - GOAL_POSITION["Z"]
        return (dx*dx + dy*dy + dz*dz) ** 0.5
    
    def compute_reward(self, pos: Dict, done: bool) -> float:
        """Compute reward with upward progress bonus"""
        r = REWARD_STEP
        
        # Check for falling below threshold
        if pos and pos.get("Y", 0) < -2:
            r += REWARD_DEATH
            done = True
            return r, done
        
        # Upward progress reward - if Y increased
        if pos:
            current_y = pos.get("Y", 0)
            if current_y > self.last_y + 0.5:  # Significant upward movement
                r += REWARD_UPWARD
            self.last_y = current_y
        
        # Goal reached
        if pos and self.dist_to_goal(pos) < GOAL_THRESHOLD:
            r += REWARD_GOAL
            done = True
            
        return r, done
    
    def run_episode(self, ep: int) -> EpisodeResult:
        self.reset_agent()
        time.sleep(0.05)
        
        traj = []
        total_r = 0.0
        done = False
        goal = False
        pos = SPAWN_POSITION.copy()
        
        # Get initial pos
        p = self.get_position()
        if p:
            pos = p
            self.last_y = pos.get("Y", SPAWN_POSITION["Y"])
            
        for step in range(MAX_STEPS):
            # Action selection - with bias toward climbing
            if random.random() < 0.25:
                # Random action
                act = random.choice(["forward", "back", "jump", "left", "right"])
            else:
                # Guided: move toward goal Z, jump to climb
                current_z = pos.get("Z", 60)
                current_y = pos.get("Y", 0)
                
                if current_y < GOAL_POSITION["Y"] - 2:
                    # Still climbing — favor jump + lateral movement (staircase is X-offset)
                    r = random.random()
                    if r < 0.4:
                        act = "jump"
                    elif r < 0.6:
                        act = "left"
                    elif r < 0.8:
                        act = "right"
                    else:
                        act = random.choice(["forward", "back"])
                else:
                    act = "jump"
            
            self.move(act)
            time.sleep(0.05)  # Wait longer to avoid collisions with World 1
            
            # Get new pos
            p = self.get_position()
            if p:
                pos = p
            
            # Compute reward
            r, done = self.compute_reward(pos, done)
            total_r += r
            
            if self.dist_to_goal(pos) < GOAL_THRESHOLD:
                goal = done = True
            
            if step % OBSERVE_EVERY == 0:
                traj.append(TrajectoryStep(ep, step, act, pos, r, total_r, done))
            
            if done:
                break
        
        return EpisodeResult(ep, total_r, step+1, goal, pos, traj)
    
    def train(self):
        print("=" * 50)
        print("ClawBlox RL Training - World 2")
        print("=" * 50)
        print(f"Episodes: {NUM_EPISODES}, Steps: {MAX_STEPS}")
        print(f"Goal: Y={GOAL_POSITION['Y']}, Threshold: {GOAL_THRESHOLD}")
        
        self.spawn_world()
        time.sleep(0.2)
        
        for ep in range(NUM_EPISODES):
            result = self.run_episode(ep)
            self.episode_results.append(result)
            
            # Print progress
            marker = "✓" if result.goal_reached else " "
            print(f"Ep {ep+1:2d}: steps={result.steps:3d}, reward={result.total_reward:6.2f}, goal={marker}")
            
            # Periodic GC
            if ep % 10 == 0:
                gc.collect()
        
        return self.episode_results
    
    def export(self, path: str = "world2_trajectories.jsonl.gz"):
        with gzip.open(path, 'wt') as f:
            for r in self.episode_results:
                for s in r.trajectory:
                    f.write(json.dumps(asdict(s)) + "\n")
        print(f"Exported to {path}")
        return path
    
    def summary(self):
        print("\n" + "=" * 50)
        print("SUMMARY")
        print("=" * 50)
        
        if not self.episode_results:
            print("No episodes!")
            return
        
        rewards = [r.total_reward for r in self.episode_results]
        goals = sum(1 for r in self.episode_results if r.goal_reached)
        
        print(f"Episodes: {len(self.episode_results)}")
        print(f"Mean reward: {sum(rewards)/len(rewards):.2f}")
        print(f"Best episode reward: {max(rewards):.2f}")
        print(f"Worst episode reward: {min(rewards):.2f}")
        print(f"Goal reach rate: {goals}/{len(self.episode_results)} ({100*goals/len(self.episode_results):.1f}%)")
        
        # Episode reward curve
        print("\nEpisode Reward Curve:")
        for i, r in enumerate(rewards):
            bar = "█" * int(max(0, (r + 20) / 2))  # Scale for visibility
            print(f"  {i+1:2d}: {r:6.2f} {bar}")


def main():
    process = psutil.Process()
    mem_start = process.memory_info().rss / 1024 / 1024
    print(f"Starting RAM: {mem_start:.1f} MB")
    
    trainer = ClawBloxRLTrainer(SEED)
    results = trainer.train()
    
    mem_end = process.memory_info().rss / 1024 / 1024
    peak = max(mem_start, mem_end)
    
    trainer.summary()
    path = trainer.export()
    
    print(f"\n" + "=" * 50)
    print("RESULTS")
    print("=" * 50)
    print(f"Peak RAM: {peak:.1f} MB")
    print(f"Trajectories: {path}")
    
    if results:
        best = max(results, key=lambda r: r.total_reward)
        goals = sum(1 for r in results if r.goal_reached)
        print(f"Best episode: #{best.episode+1}, reward={best.total_reward:.2f}")
        print(f"Goal reach rate: {goals}/{len(results)} ({100*goals/len(results):.1f}%)")


if __name__ == "__main__":
    main()
