"""ClawBlox Agent - RL-style interface."""

from dataclasses import dataclass

from .client import ClawBloxClient
from .session import ClawBloxSession
from .types import ObserveState


@dataclass
class AgentStepResult:
    """Result of an agent step."""
    state: ObserveState
    reward: float
    done: bool


class ClawBloxAgent:
    """Reinforcement learning-style interface for ClawBlox agents."""

    def __init__(
        self,
        client: ClawBloxClient,
        deterministic: bool = True,
        seed: int | None = None,
    ):
        """Initialize agent.

        Args:
            client: ClawBloxClient instance
            deterministic: Run in deterministic mode
            seed: Random seed
        """
        self.client = client
        self.deterministic = deterministic
        self.seed = seed
        self.session: ClawBloxSession | None = None
        self._step_count = 0

    def reset(self) -> ObserveState:
        """Create fresh session and get initial state.

        Returns:
            Initial observation state
        """
        self.session = ClawBloxSession.create(
            self.client,
            deterministic=self.deterministic,
            seed=self.seed,
        )
        self._step_count = 0
        return self.session.observe()

    def step(self, lua_action: str) -> AgentStepResult:
        """Execute action in session, return state + reward + done.

        Args:
            lua_action: Lua code to execute as action

        Returns:
            AgentStepResult with state, reward, and done flag
        """
        if self.session is None:
            raise RuntimeError("Agent not initialized. Call reset() first.")

        # Execute the action
        result = self.session.execute(lua_action)

        # Get the resulting state
        state = self.session.observe()

        # Simple reward: negative of execution time (faster = better)
        execution_time = result.execution_time_ms if result.execution_time_ms else 0
        reward = -float(execution_time) / 1000.0

        # Done condition: arbitrary threshold
        done = len(state.instances) > 1000

        self._step_count += 1
        return AgentStepResult(state=state, reward=reward, done=done)

    def observe(self) -> ObserveState:
        """Get current state without executing action.

        Returns:
            Current observation state
        """
        if self.session is None:
            raise RuntimeError("Agent not initialized. Call reset() first.")
        return self.session.observe()

    def run_test(self, test_code: str) -> dict:
        """Run a test in the game.

        Args:
            test_code: Test code to run

        Returns:
            Test result
        """
        return self.client.test_run(code=test_code)

    def export_trajectory(self) -> list[dict]:
        """Export the simulation trajectory.

        Returns:
            List of trajectory frames
        """
        frames = self.client.simulation_export_trajectory()
        return [
            {
                "tick": f.tick,
                "timestamp": f.timestamp,
                "seed": f.seed,
                "actions": f.actions,
                "physicsState": f.physicsState,
                "instanceChanges": f.instanceChanges,
                "consoleOutput": f.consoleOutput,
            }
            for f in frames
        ]

    def destroy(self) -> None:
        """Clean up the session."""
        if self.session:
            self.session.destroy()
            self.session = None

    def __enter__(self) -> "ClawBloxAgent":
        """Context manager entry."""
        self.reset()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context manager exit."""
        self.destroy()

    def __repr__(self) -> str:
        return f"ClawBloxAgent(deterministic={self.deterministic}, seed={self.seed})"
